from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer
from .models import ChitGroup, ChitGroupInstallmentDetail, CustomerLoanDetails, Ledger, LoanInstallment, LoanType, PaymentEntry


class OptionalSalesmanTests(TestCase):
    """Salesman (done_by_staff) is optional on every entry: an empty or null value saves as no salesman."""

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('salesman-admin', is_staff=True))
        self.customer = Customer.objects.create(customer_code='OS001', full_name='Ravi', primary_mobile='9876500400', role='BORROWER')
        self.chit = LoanType.objects.get_or_create(name='Chit')[0]
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='OS', name='Optional Salesman', duration=2, duration_type='DAY')
        for number in (1, 2):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=number, schedule_value=str(number), installment_amount=50)
        self.bank = Ledger.objects.create(name='HDFC Bank', group='Bank Accounts')

    def test_loan_saves_without_salesman(self):
        for value in (None, ''):
            response = self.client.post('/api/finance/loans/', {
                'customer_id': self.customer.pk, 'loan_type_id': self.chit.pk, 'chit_group_id': self.group.pk, 'amount': '100',
                'start_date': timezone.localdate().isoformat(), 'include_sunday': True, 'done_by_staff': value}, format='json')
            self.assertEqual(response.status_code, 201, response.data)
            self.assertIsNone(CustomerLoanDetails.objects.get(pk=response.data['id']).done_by_staff_id)

    def test_payment_entry_saves_without_salesman(self):
        response = self.client.post('/api/finance/payment-entries/', {
            'ledger_group': 'Sundry Creditors', 'account': self.bank.pk, 'amount': '250.00', 'payment_mode': 'UPI',
            'transaction_utr': 'UTR1', 'date': timezone.localdate().isoformat(), 'done_by_staff': None}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(PaymentEntry.objects.get(pk=response.data['id']).done_by_staff_id)
