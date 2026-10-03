from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer
from decimal import Decimal

from .models import ChitGroup, ChitGroupInstallmentDetail, CollectionTransaction, CustomerLoanDetails, Ledger, LoanInstallment, LoanType


class CollectionAccountTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('collection-account-admin', is_staff=True))
        customer = Customer.objects.create(customer_code='ACC001', full_name='Account Customer', primary_mobile='9876500001', role='BORROWER')
        loan_type = LoanType.objects.get_or_create(name='Chit')[0]
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        group = ChitGroup.objects.create(code='ACC', name='Account Group', duration=2, duration_type='DAY')
        for number in (1, 2):
            ChitGroupInstallmentDetail.objects.create(group=group, installment_number=number, schedule_value=str(number), installment_amount=2500)
        response = self.client.post('/api/finance/loans/', {'customer_id': customer.pk, 'loan_type_id': loan_type.pk, 'amount': '5000',
            'start_date': timezone.localdate().isoformat(), 'chit_group_id': group.pk, 'include_sunday': True}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.loan = response.data
        self.url = f"/api/finance/customer-loan-installments/{self.loan['installments'][0]['id']}/collect/"
        self.cash = Ledger.objects.create(name='Cash', group='Cash-in-Hand')

    def collect(self, **extra):
        return self.client.post(self.url, {'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': '10', 'payment_mode': 'Cash', **extra}, format='json')

    def test_ledger_amount_is_saved_separately_from_loan_collection(self):
        response = self.collect(customer_paid_amount='5000', account_id=self.cash.pk, ledger_group='Sundry Creditors', ledger_amount='48484')
        self.assertEqual(response.status_code, 200, response.data)
        row = CollectionTransaction.objects.get(loan_id=self.loan['id'])
        self.assertEqual((row.account_id, row.ledger_group, row.ledger_amount, row.collection_amount), (self.cash.pk, 'Sundry Creditors', Decimal('48484.00'), Decimal('5000.00')))
        self.assertEqual((row.adjustment_amount, row.discount_amount), (Decimal('0.00'), Decimal('0.00')))
        loan = CustomerLoanDetails.objects.get(pk=self.loan['id'])
        self.assertEqual((loan.paid_amount, loan.penalty_amount, loan.outstanding_amount), (Decimal('5000.00'), Decimal('0.00'), Decimal('0.00')))
        self.assertFalse(loan.installment_details.exclude(penalty_amount=0).exists())

    def test_invalid_ledger_details_are_rejected_without_saving(self):
        for extra in ({'ledger_amount': '10'}, {'ledger_group': 'Other', 'ledger_amount': '10'}, {'ledger_group': 'Income', 'ledger_amount': '-1'}, {'ledger_group': 'Income', 'ledger_amount': 'abc'}):
            response = self.collect(**extra)
            self.assertEqual(response.status_code, 400, extra)
            self.assertIsInstance(response.data['detail'], str)
        self.assertFalse(CollectionTransaction.objects.exists())

    def test_non_cash_or_bank_ledger_is_rejected_without_saving(self):
        income = Ledger.objects.create(name='Interest Income', group='Income')
        for account_id in (income.pk, 999999, 'abc'):
            self.assertEqual(self.collect(account_id=account_id).status_code, 400)
        self.assertFalse(CollectionTransaction.objects.exists())

    def test_account_remains_optional_for_existing_callers(self):
        self.assertEqual(self.collect().status_code, 200)
        self.assertIsNone(CollectionTransaction.objects.get(loan_id=self.loan['id']).account_id)
