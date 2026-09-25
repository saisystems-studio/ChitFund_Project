from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer
from .models import ChitGroup, ChitGroupInstallmentDetail, Ledger, LoanInstallment, LoanType, Mortgage, PaymentEntry


class DeleteMessageTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('delete-admin', is_staff=True))
        self.customer = Customer.objects.create(customer_code='DEL001', full_name='Delete Customer', primary_mobile='9876500002', role='BORROWER')
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='DEL', name='Delete Group', duration=1, duration_type='DAY')
        ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=1, schedule_value='1', installment_amount=100)

    def chit_loan(self):
        response = self.client.post('/api/finance/loans/', {'customer_id': self.customer.pk, 'loan_type_id': LoanType.objects.get_or_create(name='Chit')[0].pk,
            'amount': '100', 'start_date': timezone.localdate().isoformat(), 'chit_group_id': self.group.pk, 'include_sunday': True}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_unused_records_delete(self):
        for url, obj in (('ledgers', Ledger.objects.create(name='Spare', group='Income')), ('mortgages', Mortgage.objects.create(product_name='Spare', unit='Gram', current_rate=1))):
            self.assertEqual(self.client.delete(f'/api/finance/{url}/{obj.pk}/').status_code, 204)
            self.assertFalse(type(obj).objects.filter(pk=obj.pk).exists())

    def test_used_ledger_explains_the_reason(self):
        ledger = Ledger.objects.create(name='Rent', group='Indirect Expense')
        for _ in range(2): PaymentEntry.objects.create(ledger=ledger, accounts='Card', amount=10, payment_mode='Cash')
        response = self.client.delete(f'/api/finance/ledgers/{ledger.pk}/')
        self.assertEqual((response.status_code, response.data['detail']), (409, 'This ledger cannot be deleted because it is used in 2 payment entries.'))
        self.assertTrue(Ledger.objects.filter(pk=ledger.pk).exists())

    def test_used_customer_and_chit_group_explain_the_reason(self):
        self.chit_loan()
        response = self.client.delete(f'/api/customers/{self.customer.pk}/')
        self.assertEqual((response.status_code, response.data['detail']), (409, 'This customer cannot be deleted because it is used in 1 loan.'))
        response = self.client.delete(f'/api/finance/chit-groups/{self.group.pk}/')
        self.assertEqual((response.status_code, response.data['detail']), (409, 'This chit group cannot be deleted because it is used in 1 chit loan.'))

    def test_loan_with_collections_explains_the_reason(self):
        loan = self.chit_loan()
        response = self.client.post(f"/api/finance/customer-loan-installments/{loan['installments'][0]['id']}/collect/",
                                    {'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': '10'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.delete(f"/api/finance/loans/{loan['id']}/")
        self.assertEqual((response.status_code, response.data['detail']), (409, 'This loan cannot be deleted because it is used in 1 collection.'))
