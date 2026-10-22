from decimal import Decimal
from django.test import TestCase
from . import test_party_collection as fixtures
from .models import Ledger, PartyDue, PartyCollection, PartyAllocation
from .accounting_reports import ledger_balances

class OthersOutstandingTests(TestCase):
    setUp = fixtures.PartyCollectionTests.setUp
    ledger = fixtures.PartyCollectionTests.ledger

    def test_normal_ledger_due_and_others_have_real_dates_and_balances(self):
        rent = Ledger.objects.create(name='Rent', group='Indirect Expense')
        due = PartyDue.objects.create(party=rent, counter_ledger=self.income, due_date='2026-10-08', due_number='RENT-1', amount='5000')
        response = self.client.post('/api/finance/party-collections/', {'party':rent.pk,'account':self.cash.pk,'payment_mode':'Cash','date':'2026-10-15','amount':'3000'},format='json')
        self.assertEqual(response.status_code,201,response.data)
        result = self.client.get('/api/finance/party-collections/summary/',{'party':rent.pk})
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['remaining_outstanding'],Decimal('2000'))
        self.assertEqual(result.data['unallocated_advance'],Decimal('3000'))
        self.assertEqual([(str(row['date']),row['debit'],row['credit']) for row in result.data['entries']], [('2026-10-08',Decimal('5000'),Decimal('0')),('2026-10-15',Decimal('0'),Decimal('3000'))])
        self.assertEqual(PartyDue.objects.filter(party=rent).count(),1)
        self.assertEqual(PartyCollection.objects.filter(party=rent).count(),1)
        self.assertFalse(PartyAllocation.objects.filter(collection__party=rent).exists())
        _, balances, _ = ledger_balances()
        self.assertEqual(balances[rent.pk],Decimal('2000'))
        self.assertEqual(balances[self.cash.pk],Decimal('3000'))

    def test_no_due_is_unallocated_credit_not_pending(self):
        ledger = Ledger.objects.create(name='Fees',group='Income')
        self.client.post('/api/finance/party-collections/',{'party':ledger.pk,'account':self.cash.pk,'payment_mode':'Cash','date':'2026-10-15','amount':'3000'},format='json')
        result=self.client.get('/api/finance/party-collections/summary/',{'party':ledger.pk})
        self.assertEqual(result.status_code,200,result.data)
        self.assertEqual(result.data['remaining_outstanding'],0)
        self.assertEqual(result.data['total_due'],0)
        self.assertEqual(result.data['unallocated_advance'],Decimal('3000'))
        self.assertEqual(len(result.data['entries']),1)
        self.assertEqual(result.data['entries'][0]['particulars'],'Others Collection')

    def test_later_allocation_does_not_create_a_second_credit(self):
        due = PartyDue.objects.create(party=self.party_a,counter_ledger=self.income,due_date='2026-10-08',due_number='D1',amount='5000')
        result=self.client.post('/api/finance/party-collections/',{'party':self.party_a.pk,'account':self.cash.pk,'payment_mode':'Cash','date':'2026-10-15','amount':'3000','advance_amount':'3000','allocations':[]},format='json')
        self.assertEqual(result.status_code,201,result.data)
        result=self.client.post('/api/finance/party-collections/allocate-advance/',{'party':self.party_a.pk,'allocations':[{'due':due.pk,'amount':'3000'}]},format='json')
        self.assertEqual(result.status_code,201,result.data)
        summary=self.client.get('/api/finance/party-collections/summary/',{'party':self.party_a.pk}).data
        self.assertEqual(summary['remaining_outstanding'],Decimal('2000'))
        self.assertEqual(summary['unallocated_credit'],0)
        self.assertEqual(sum(row['credit'] for row in summary['entries']),Decimal('3000'))
        self.assertEqual(len(summary['entries']),2)
        self.assertEqual(PartyCollection.objects.filter(party=self.party_a).count(),1)
