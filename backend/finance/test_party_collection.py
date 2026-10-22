"""Party Collection (ledger-based, Due-wise / Consolidated) -- independent of loan collections."""
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .accounting_reports import ledger_balances, trial_balance
from .models import CollectionTransaction, Ledger, PartyAllocation, PartyCollection, PartyDue

D = Decimal


class PartyCollectionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('party-admin', is_staff=True))
        self.cash = Ledger.objects.create(name='CASH', group='Cash-in-Hand')
        self.bank = Ledger.objects.create(name='KVB', group='Bank Accounts', bank_name='KVB', branch_name='Main', ifsc_code='KVBL0001234', account_number='123456789')
        self.income = Ledger.objects.create(name='Party Due Income', group='Income')
        self.party_a = self.ledger('Party A', Ledger.DUE_WISE)
        self.party_b = self.ledger('Party B', Ledger.CONSOLIDATED)

    def ledger(self, name, collection_type):
        response = self.client.post('/api/finance/ledgers/', {'name': name, 'group': 'Sundry Debtors', 'collection_type': collection_type}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return Ledger.objects.get(pk=response.data['id'])

    def due(self, party, number, on, amount='10000'):
        response = self.client.post('/api/finance/party-dues/', {'party': party.pk, 'counter_ledger': self.income.pk, 'due_date': on,
                                                                 'due_number': number, 'amount': amount}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def collect(self, party, amount, **extra):
        payload = {'party': party.pk, 'account': self.cash.pk, 'payment_mode': 'Cash', 'date': '2026-04-05', 'amount': amount, **extra}
        return self.client.post('/api/finance/party-collections/', payload, format='json')

    def summary(self, party):
        response = self.client.get('/api/finance/party-collections/summary/', {'party': party.pk})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def pending(self, party):
        return [(row['due_number'], row['pending']) for row in self.summary(party)['dues']]

    def test_collection_type_only_for_sundry_debtors_and_never_set_automatically(self):
        other = self.client.post('/api/finance/ledgers/', {'name': 'Rent', 'group': 'Indirect Expense', 'collection_type': 'DUE_WISE'}, format='json')
        self.assertEqual(other.data['collection_type'], '')
        plain = self.client.post('/api/finance/ledgers/', {'name': 'Old Debtor', 'group': 'Sundry Debtors'}, format='json')
        self.assertEqual(plain.data['collection_type'], '')
        party = Ledger.objects.get(pk=plain.data['id'])
        self.assertEqual(self.client.post('/api/finance/party-dues/', {'party': party.pk, 'counter_ledger': self.income.pk, 'due_date': '2026-04-01',
                                                                       'due_number': '1st Due', 'amount': '10'}, format='json').status_code, 400)

    def test_due_posts_dr_party_cr_counter_ledger_and_validates(self):
        self.due(self.party_a, '1st Due', '2026-04-01')
        self.due(self.party_a, '2nd Due', '2026-04-02')
        duplicate = self.client.post('/api/finance/party-dues/', {'party': self.party_a.pk, 'counter_ledger': self.income.pk, 'due_date': '2026-04-03',
                                                                  'due_number': '1ST DUE', 'amount': '5'}, format='json')
        self.assertEqual(duplicate.status_code, 400)
        for counter in (self.cash, self.bank, self.party_a):
            response = self.client.post('/api/finance/party-dues/', {'party': self.party_a.pk, 'counter_ledger': counter.pk, 'due_date': '2026-04-03',
                                                                     'due_number': 'X', 'amount': '5'}, format='json')
            self.assertEqual(response.status_code, 400, counter.name)
        _, balances, suspense = ledger_balances()
        self.assertEqual((balances[self.party_a.pk], balances[self.income.pk], suspense), (D('20000'), D('-20000'), 0))
        self.assertEqual(self.summary(self.party_a)['total_due'], D('20000.00'))

    def test_party_a_due_wise_collection_advance_and_later_allocation(self):
        first = self.due(self.party_a, '1st Due', '2026-04-01')
        second = self.due(self.party_a, '2nd Due', '2026-04-02')
        # Allocations must add up to the Collection Amount and never exceed a due's pending.
        self.assertEqual(self.collect(self.party_a, '5000', allocations=[{'due': first['id'], 'amount': '4000'}]).status_code, 400)
        self.assertEqual(self.collect(self.party_a, '12000', allocations=[{'due': first['id'], 'amount': '12000'}]).status_code, 400)
        self.assertEqual(self.collect(self.party_a, '5000', allocations=[{'due': self.due(self.party_b, 'B1', '2026-04-01')['id'], 'amount': '5000'}]).status_code, 400)
        response = self.collect(self.party_a, '5000', allocations=[{'due': first['id'], 'amount': '5000'}, {'due': second['id'], 'amount': '0'}])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(self.pending(self.party_a), [('1st Due', D('5000.00')), ('2nd Due', D('10000.00'))])
        data = self.summary(self.party_a)
        self.assertEqual((data['outstanding'], data['outstanding_type'], data['unallocated_advance']), (D('15000.00'), 'DR', D('0.00')))
        # Others = unallocated advance: dues untouched, ledger outstanding reduced.
        others = self.collect(self.party_a, '5000', advance_amount='5000', account=self.bank.pk, payment_mode='UPI', upi_id='a@b', transaction_utr='U1')
        self.assertEqual(others.status_code, 201, others.data)
        data = self.summary(self.party_a)
        self.assertEqual((data['total_pending'], data['unallocated_advance'], data['outstanding']), (D('15000.00'), D('5000.00'), D('10000.00')))
        _, before, _ = ledger_balances()
        # Applying the advance later: no new receipt, no Cash/Bank movement, no double counting.
        self.assertEqual(self.client.post('/api/finance/party-collections/allocate-advance/', {'party': self.party_a.pk, 'allocations': [{'due': first['id'], 'amount': '6000'}]}, format='json').status_code, 400)
        applied = self.client.post('/api/finance/party-collections/allocate-advance/', {'party': self.party_a.pk, 'allocations': [{'due': first['id'], 'amount': '5000'}]}, format='json')
        self.assertEqual(applied.status_code, 201, applied.data)
        self.assertEqual(PartyCollection.objects.count(), 2)
        self.assertEqual(PartyAllocation.objects.filter(from_advance=True).count(), 1)
        _, after, _ = ledger_balances()
        self.assertEqual(before, after)
        self.assertEqual(self.pending(self.party_a), [('1st Due', D('0.00')), ('2nd Due', D('10000.00'))])
        data = self.summary(self.party_a)
        self.assertEqual((data['unallocated_advance'], data['outstanding'], data['total_collected']), (D('0.00'), D('10000.00'), D('10000.00')))
        self.assertEqual(self.client.post('/api/finance/party-collections/allocate-advance/', {'party': self.party_a.pk, 'allocations': [{'due': second['id'], 'amount': '1'}]}, format='json').status_code, 400)
        # Cash and Bank ledgers each got their receipt exactly once; Trial Balance balances.
        self.assertEqual((after[self.cash.pk], after[self.bank.pk]), (D('5000'), D('5000')))
        totals = trial_balance()
        self.assertEqual(totals['total_debit'], totals['total_credit'])
        for kind, closing in (('cash', '5000.00'), ('bank', '5000.00')):
            self.assertEqual(str(self.client.get('/api/finance/reports/ledger/', {'type': kind}).data['closing_balance']), closing)

    def test_party_b_consolidated_collection_has_no_due_split(self):
        first = self.due(self.party_b, '1st Due', '2026-04-01')
        self.due(self.party_b, '2nd Due', '2026-04-02')
        self.assertEqual(self.collect(self.party_b, '5000', allocations=[{'due': first['id'], 'amount': '5000'}]).status_code, 400)
        self.assertEqual(self.collect(self.party_b, '5000').status_code, 201)
        data = self.summary(self.party_b)
        self.assertNotIn('dues', data)
        self.assertNotIn('unallocated_advance', data)
        self.assertEqual((data['total_due'], data['total_received'], data['outstanding'], data['outstanding_type']), (D('20000.00'), D('5000.00'), D('15000.00'), 'DR'))

    def test_account_and_payment_mode_must_match(self):
        self.due(self.party_b, '1st Due', '2026-04-01')
        self.assertEqual(self.collect(self.party_b, '100', account=self.bank.pk).status_code, 400)
        self.assertEqual(self.collect(self.party_b, '100', payment_mode='UPI', upi_id='a@b', transaction_utr='U').status_code, 400)
        self.assertEqual(self.collect(self.party_b, '100', account=self.bank.pk, payment_mode='NEFT').status_code, 400)
        response = self.collect(self.party_b, '100', account=self.bank.pk, payment_mode='RTGS', transaction_utr='R1', bank_name='KVB', upi_id='stale')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['upi_id'], '')

    def test_edit_and_delete_keep_dues_and_postings_consistent(self):
        first = self.due(self.party_a, '1st Due', '2026-04-01')
        receipt = self.collect(self.party_a, '5000', allocations=[{'due': first['id'], 'amount': '3000'}], advance_amount='2000').data
        url = f"/api/finance/party-collections/{receipt['id']}/"
        self.assertEqual(self.client.patch(url, {'amount': '2000'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'amount': '4000', 'notes': 'edited'}, format='json').status_code, 200)
        self.assertEqual(self.summary(self.party_a)['unallocated_advance'], D('1000.00'))
        due_url = f"/api/finance/party-dues/{first['id']}/"
        self.assertEqual(self.client.patch(due_url, {'amount': '2000'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(due_url, {'amount': '12000'}, format='json').status_code, 200)
        self.assertEqual(self.client.delete(due_url).status_code, 409)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(PartyAllocation.objects.exists())
        self.assertEqual(self.summary(self.party_a)['outstanding'], D('12000.00'))
        self.assertEqual(self.client.delete(due_url).status_code, 204)
        _, balances, _ = ledger_balances()
        self.assertEqual((balances[self.party_a.pk], balances[self.cash.pk], balances[self.income.pk]), (0, 0, 0))

    def test_today_report_lists_each_party_voucher_once(self):
        first = self.due(self.party_a, '1st Due', '2026-04-01')
        second = self.due(self.party_a, '2nd Due', '2026-04-02')
        self.collect(self.party_a, '15000', allocations=[{'due': first['id'], 'amount': '10000'}, {'due': second['id'], 'amount': '5000'}])
        self.collect(self.party_b, '700', account=self.bank.pk, payment_mode='UPI', upi_id='a@b', transaction_utr='U1')
        report = self.client.get('/api/finance/reports/today/', {'from': '2026-04-05', 'to': '2026-04-05'}).data
        rows = sorted((row['transaction_type'], row['party'], str(row['amount']), row['account_type']) for row in report['rows'])
        self.assertEqual(rows, [('Collection Entry', 'Party A', '15000.00', 'Cash'), ('Collection Entry', 'Party B', '700.00', 'Bank')])
        self.assertEqual(report['totals']['Collection Entry'], {'count': 2, 'amount': D('15700.00')})
        self.assertFalse(CollectionTransaction.objects.exists())
