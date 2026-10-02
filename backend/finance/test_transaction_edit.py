from datetime import date
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from customers.models import Customer
from .models import (CollectionTransaction, CustomerLoanDetails, CustomerLoanInstallmentDetails,
                     LoanType, Mortgage, MortgageRate)


class TransactionEditTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('editor', is_staff=True))
        self.customer = Customer.objects.create(customer_code='EDIT', full_name='Edit Customer', primary_mobile='9876543210')
        self.loan = CustomerLoanDetails.objects.create(customer=self.customer, loan_type=LoanType.objects.get_or_create(name='Chit')[0], loan_start_date=date(2026, 1, 1), loan_amount=300, total_amount=300, outstanding_amount=300)
        self.rows = [CustomerLoanInstallmentDetails.objects.create(loan=self.loan, installment_number=i, due_date=date(2026, 1, i), installment_amount=100, outstanding_amount=100) for i in (1, 2, 3)]

    def collect(self, amount, **extra):
        result = self.client.post(f'/api/finance/customer-loan-installments/{self.rows[0].pk}/collect/', {'customer_paid_amount': str(amount), 'payment_date': '2026-01-10', **extra}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        return result.data['collection_id']

    def url(self, pk):
        return f'/api/finance/collection-transactions/{pk}/'

    def test_update_same_receipt_reverses_and_reapplies_fifo(self):
        pk = self.collect(150)
        other = self.collect(30)
        result = self.client.get(self.url(pk))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data['customer_name'], 'Edit Customer')
        self.assertEqual(len(result.data['allocations']), 2)
        result = self.client.patch(self.url(pk), {'collection_amount': '80', 'collection_date': '2026-01-12', 'remarks': 'Corrected', 'payment_mode': 'UPI', 'upi_id': 'payer@bank', 'reference_no': 'UTR123'}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(result.data['id'], pk)
        self.assertEqual(result.data['remarks'], 'Corrected')
        self.assertEqual(list(self.loan.installment_details.values_list('paid_amount', flat=True)), [Decimal('80'), Decimal('30'), Decimal('0')])
        self.assertEqual(CollectionTransaction.objects.get(pk=other).collection_amount, 30)
        self.rows[0].refresh_from_db()
        self.assertEqual(self.rows[0].paid_date, date(2026, 1, 12))

    def test_delete_preserves_other_receipt_and_reopens_loan(self):
        pk = self.collect(250, penalty='5')
        other = self.collect(50)
        result = self.client.delete(self.url(pk))
        self.assertEqual(result.status_code, 204, getattr(result, 'data', None))
        self.assertFalse(CollectionTransaction.objects.filter(pk=pk).exists())
        self.assertTrue(CollectionTransaction.objects.filter(pk=other).exists())
        self.assertEqual(list(self.loan.installment_details.values_list('paid_amount', flat=True)), [0, 0, 50])
        self.loan.refresh_from_db()
        self.assertEqual((self.loan.paid_amount, self.loan.penalty_amount, self.loan.outstanding_amount, self.loan.loan_status), (50, 0, 250, 'ACTIVE'))
        self.rows[0].refresh_from_db()
        self.assertIsNone(self.rows[0].paid_date)

    def test_invalid_update_rolls_back_and_legacy_delete_is_safe(self):
        pk = self.collect(150)
        for data in ({'collection_amount': '400'}, {'collection_amount': 'NaN'}, {'collection_amount': '0'}, {'account': 999999}, {'payment_mode': 'Cheque'}):
            result = self.client.patch(self.url(pk), data, format='json')
            self.assertEqual(result.status_code, 400, data)
            self.assertEqual(CollectionTransaction.objects.get(pk=pk).collection_amount, 150)
            self.assertEqual(list(self.loan.installment_details.values_list('paid_amount', flat=True)), [100, 50, 0])
        CollectionTransaction.objects.get(pk=pk).allocations.all().delete()
        self.assertEqual(self.client.delete(self.url(pk)).status_code, 400)
        self.assertTrue(CollectionTransaction.objects.filter(pk=pk).exists())

    def test_view_only_cannot_mutate(self):
        pk = self.collect(20)
        self.client.force_authenticate(User.objects.create_user('viewer'))
        self.assertEqual(self.client.get(self.url(pk)).status_code, 200)
        self.assertEqual(self.client.patch(self.url(pk), {'remarks': 'Denied'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(self.url(pk)).status_code, 403)

    def test_mortgage_same_date_edit_preserves_older_history_and_delete(self):
        product = Mortgage.objects.create(product_name='Gold edit', unit='Gram', current_rate=20)
        MortgageRate.objects.create(mortgage=product, date=date(2026, 1, 1), rate=10)
        latest = MortgageRate.objects.create(mortgage=product, date=date(2026, 1, 2), rate=20)
        result = self.client.patch(f'/api/finance/mortgages/{product.pk}/', {'current_rate': '25', 'rate_date': '2026-01-02'}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        latest.refresh_from_db()
        self.assertEqual(latest.rate, 25)
        self.assertEqual(product.rates.get(date=date(2026, 1, 1)).rate, 10)
        self.assertEqual(self.client.delete(f'/api/finance/mortgages/{product.pk}/').status_code, 204)
        self.assertFalse(Mortgage.objects.filter(pk=product.pk).exists())
