from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Ledger, PaymentEntry


class PaymentEntryLedgerGroupTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('payment-admin', is_staff=True))
        self.bank = Ledger.objects.create(name='HDFC Bank', group='Bank Accounts')
        self.payload = {'ledger_group': 'Sundry Creditors', 'account': self.bank.pk, 'amount': '1250.00', 'payment_mode': 'Cheque',
                        'date': timezone.localdate().isoformat(), 'cheque_number': '000123', 'cheque_date': timezone.localdate().isoformat(),
                        'bank_name': 'HDFC', 'notes': 'Supplier advance'}

    def test_ledger_group_account_and_notes_are_saved(self):
        response = self.client.post('/api/finance/payment-entries/', self.payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        saved = PaymentEntry.objects.get(pk=response.data['id'])
        self.assertEqual((saved.ledger_group, saved.account_id, saved.amount, saved.notes, saved.ledger_id, saved.accounts),
                         ('Sundry Creditors', self.bank.pk, Decimal('1250.00'), 'Supplier advance', None, ''))
        self.assertEqual(response.data['account_name'], 'HDFC Bank')

    def test_invalid_ledger_or_account_is_rejected(self):
        income = Ledger.objects.create(name='Interest', group='Income')
        for invalid in ({'ledger_group': ''}, {'ledger_group': 'Cash in Hand'}, {'account': None}, {'account': income.pk}, {'cheque_number': ''}):
            response = self.client.post('/api/finance/payment-entries/', {**self.payload, **invalid}, format='json')
            self.assertEqual(response.status_code, 400, (invalid, response.data))
        self.assertFalse(PaymentEntry.objects.exists())

    def test_account_in_use_cannot_be_deleted(self):
        self.assertEqual(self.client.post('/api/finance/payment-entries/', self.payload, format='json').status_code, 201)
        response = self.client.delete(f'/api/finance/ledgers/{self.bank.pk}/')
        self.assertEqual((response.status_code, response.data['detail']), (409, 'This ledger cannot be deleted because it is used in 1 payment entry.'))
