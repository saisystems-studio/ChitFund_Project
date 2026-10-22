from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Group, Ledger


def root(name):
    return Group.objects.filter(parent__isnull=True, name=name).first() or Group.objects.create(name=name, is_system=True)


BANK = {'bank_name': 'State Bank of India', 'branch_name': 'Anna Nagar', 'ifsc_code': 'sbin0001234', 'account_number': '1234 5678 9012'}


class LedgerBankDetailsTests(TestCase):
    """Bank Name / Branch / IFSC / Account Number are saved for Bank Accounts ledgers only."""

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('bank-admin', is_staff=True))
        self.bank_root = root('Bank Accounts')
        self.expense_root = root('Indirect Expense')

    def post(self, **data):
        return self.client.post('/api/finance/ledgers/', {'name': 'HDFC Current', 'opening_balance': '-2500', **data}, format='json')

    def test_bank_ledger_saves_and_fetches_normalised_details(self):
        response = self.post(group_detail=self.bank_root.pk, **BANK)
        self.assertEqual(response.status_code, 201, response.data)
        fetched = self.client.get(f"/api/finance/ledgers/{response.data['id']}/").data
        self.assertEqual({key: fetched[key] for key in BANK},
                         {'bank_name': 'State Bank of India', 'branch_name': 'Anna Nagar', 'ifsc_code': 'SBIN0001234', 'account_number': '123456789012'})
        # Existing bindings are untouched: legacy group string, signed opening balance (CR).
        self.assertEqual((fetched['group'], Decimal(fetched['opening_balance'])), ('Bank Accounts', Decimal('-2500.00')))

    def test_bank_ledger_under_a_bank_sub_group_also_needs_details(self):
        child = Group.objects.create(name='Current Accounts', parent=self.bank_root)
        response = self.post(group_detail=child.pk)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.data), {'bank_name', 'branch_name', 'ifsc_code', 'account_number'})

    def test_ifsc_and_account_number_are_validated(self):
        response = self.post(group_detail=self.bank_root.pk, **{**BANK, 'ifsc_code': 'SBIN123', 'account_number': '12AB34'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('IFSC', str(response.data['ifsc_code']))
        self.assertIn('9 to 18 digits', str(response.data['account_number']))
        self.assertEqual(self.post(group_detail=self.bank_root.pk, **{**BANK, 'ifsc_code': 'SBIN1001234'}).status_code, 400)

    def test_other_groups_ignore_and_clear_bank_details(self):
        response = self.post(group_detail=self.expense_root.pk, **BANK)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual([response.data[key] for key in BANK], ['', '', '', ''])
        self.assertEqual(self.post(group='Indirect Expense', name='Rent').status_code, 201)

    def test_moving_a_ledger_out_of_bank_accounts_clears_details(self):
        ledger = self.post(group_detail=self.bank_root.pk, **BANK).data
        moved = self.client.put(f"/api/finance/ledgers/{ledger['id']}/", {**ledger, 'group_detail': self.expense_root.pk}, format='json')
        self.assertEqual(moved.status_code, 200, moved.data)
        self.assertEqual(Ledger.objects.get(pk=ledger['id']).ifsc_code, '')

    def test_legacy_bank_ledger_can_still_be_renamed(self):
        legacy = Ledger.objects.create(name='Old Bank', group='Bank Accounts', group_detail=self.bank_root)
        response = self.client.patch(f'/api/finance/ledgers/{legacy.pk}/', {'name': 'Old Bank A/c'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        # A full edit from the Ledger form must supply the details.
        self.assertEqual(self.client.put(f'/api/finance/ledgers/{legacy.pk}/', {'name': 'Old Bank', 'group_detail': self.bank_root.pk, 'opening_balance': '0'}, format='json').status_code, 400)
