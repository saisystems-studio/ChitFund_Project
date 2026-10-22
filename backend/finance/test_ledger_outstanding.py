from decimal import Decimal
from django.test import TestCase
from . import test_party_collection as fixtures
from .models import PartyDue,PartyCollection,PartyAllocation

class LedgerOutstandingTests(TestCase):
 setUp=fixtures.PartyCollectionTests.setUp
 ledger=fixtures.PartyCollectionTests.ledger
 def report(self,**params):
  r=self.client.get('/api/finance/party-collections/summary/',{'view':'ledger','party':self.party_a.pk,**params})
  self.assertEqual(r.status_code,200,r.data)
  return r.data
 def test_others_does_not_pay_due_and_later_allocation_does_not_post_again(self):
  due=PartyDue.objects.create(party=self.party_a,counter_ledger=self.income,due_date='2026-04-08',due_number='D1',amount='5000')
  receipt=PartyCollection.objects.create(party=self.party_a,account=self.cash,date='2026-04-10',amount='5000',payment_mode='Cash')
  r=self.report(to='2026-04-10')
  self.assertEqual((r['total_due'],r['allocated_collection'],r['due_pending'],r['unallocated_others'],r['closing_balance']),(Decimal('5000'),0,Decimal('5000'),Decimal('5000'),0))
  self.assertEqual([(str(e['date']),e['debit'],e['credit']) for e in r['entries']],[('2026-04-08',Decimal('5000'),0),('2026-04-10',0,Decimal('5000'))])
  PartyAllocation.objects.create(collection=receipt,due=due,amount='1000',date='2026-04-12',from_advance=True)
  self.assertEqual(self.report(to='2026-04-10')['due_pending'],Decimal('5000'))
  r=self.report(to='2026-04-12')
  self.assertEqual((r['due_pending'],r['unallocated_others'],r['closing_balance']),(Decimal('4000'),Decimal('4000'),0))
  self.assertEqual(len(r['entries']),2)
  r=self.report(**{'from':'2026-04-10','to':'2026-04-10'})
  self.assertEqual(r['opening_balance'],Decimal('5000'))
  self.assertEqual(len(r['entries']),1)
  receipt.delete()
  self.assertEqual(self.report(to='2026-04-12')['closing_balance'],Decimal('5000'))
 def test_regular_allocated_collection_and_filters(self):
  due=PartyDue.objects.create(party=self.party_a,counter_ledger=self.income,due_date='2026-04-08',due_number='D1',amount='5000')
  receipt=PartyCollection.objects.create(party=self.party_a,account=self.cash,date='2026-04-10',amount='1000',payment_mode='Cash')
  PartyAllocation.objects.create(collection=receipt,due=due,amount='1000',date='2026-04-10')
  r=self.report(to='2026-04-10')
  self.assertEqual((r['allocated_collection'],r['due_pending'],r['unallocated_others'],r['closing_balance']),(Decimal('1000'),Decimal('4000'),0,Decimal('4000')))
  self.assertEqual(self.report(to='2026-04-09')['due_pending'],Decimal('5000'))


class LoanLedgerOutstandingTests(TestCase):
 from . import test_collection_receipt as receipt_fixtures
 setUp=receipt_fixtures.CollectionReceiptTests.setUp
 loan=receipt_fixtures.CollectionReceiptTests.loan
 def test_linked_loan_allocations_advance_dates_edit_and_delete(self):
  from .models import ChitGroupInstallmentDetail
  from .cash_bank import customer_ledger
  self.group.duration=1;self.group.save()
  ChitGroupInstallmentDetail.objects.filter(group=self.group).delete()
  ChitGroupInstallmentDetail.objects.create(group=self.group,installment_number=1,schedule_value='1',installment_amount='5000')
  loan=self.loan('Chit',start_date='2026-04-08');due=loan['installments'][0]
  ledger=customer_ledger(self.customer)
  response=self.client.post(f"/api/finance/customer-loan-installments/{due['id']}/collect/",{'payment_date':'2026-04-10','customer_paid_amount':'1000','party_ledger_id':ledger.pk,'allocations':[{'installment_id':due['id'],'amount':'1000'}]},format='json')
  self.assertEqual(response.status_code,200,response.data)
  def report(on):return self.client.get('/api/finance/party-collections/summary/',{'view':'ledger','party':ledger.pk,'to':on}).data
  r=report('2026-04-10')
  self.assertEqual((r['total_due'],r['allocated_collection'],r['due_pending'],r['closing_balance']),(Decimal('5000'),Decimal('1000'),Decimal('4000'),Decimal('4000')))
  self.assertEqual(len(r['entries']),2)
  self.assertEqual(report('2026-04-09')['due_pending'],Decimal('5000'))
  url=f"/api/finance/collection-transactions/{response.data['collection_id']}/"
  edit=self.client.patch(url,{'collection_amount':'500'},format='json');self.assertEqual(edit.status_code,200,edit.data)
  self.assertEqual(report('2026-04-10')['due_pending'],Decimal('4500'))
  self.assertEqual(self.client.delete(url).status_code,204)
  self.assertEqual(report('2026-04-10')['closing_balance'],Decimal('5000'))

 def test_saved_future_dues_scope_does_not_include_future_receipts(self):
  from .models import PartyDue,PartyCollection
  from .party_collection import ledger_outstanding
  from .cash_bank import customer_ledger
  ledger=customer_ledger(self.customer)
  # Use saved loan schedule, not a fabricated ledger posting.
  loan=self.loan('Chit',start_date='2026-11-05')
  current=ledger_outstanding(ledger,{'to':'2026-10-15'})
  expanded=ledger_outstanding(ledger,{'to':'2026-10-15','due_scope':'all_saved'})
  self.assertEqual(current['entries'],[])
  self.assertTrue(expanded['entries'])
  self.assertTrue(all(e['particulars']=='Due' for e in expanded['entries']))
  self.assertEqual(expanded['due_pending'],0)


class LedgerOutstandingSourcesTests(TestCase):
 setUp=fixtures.PartyCollectionTests.setUp
 ledger=fixtures.PartyCollectionTests.ledger
 def report(self,**params):
  r=self.client.get('/api/finance/party-collections/summary/',{'view':'ledger','party':self.party_a.pk,**params})
  self.assertEqual(r.status_code,200,r.data)
  return r.data
 def test_collection_against_a_not_yet_due_due_shows_that_due(self):
  # Kumar: Due 5,000 (not yet due), Collection 1,000 allocated to it -> 4,000 pending, 4,000 Dr.
  due=PartyDue.objects.create(party=self.party_a,counter_ledger=self.income,due_date='2026-11-05',due_number='D2',amount='5000')
  receipt=PartyCollection.objects.create(party=self.party_a,account=self.cash,date='2026-10-15',amount='1000',payment_mode='Cash')
  PartyAllocation.objects.create(collection=receipt,due=due,amount='1000',date='2026-10-15')
  r=self.report(to='2026-10-15')
  self.assertEqual([(e['particulars'],e['debit'],e['credit']) for e in r['entries']],[('Collection',0,Decimal('1000')),('Due',Decimal('5000'),0)])
  self.assertEqual((r['due_pending'],r['closing_balance'],r['future_receivables'],r['unallocated_others']),(Decimal('4000'),Decimal('4000'),0,0))
 def test_payment_and_journal_postings_are_included_once(self):
  from .models import PaymentEntry,JournalVoucher,JournalLine
  PartyDue.objects.create(party=self.party_a,counter_ledger=self.income,due_date='2026-04-08',due_number='D1',amount='5000')
  PaymentEntry.objects.create(ledger=self.party_a,account=self.cash,amount='300',payment_mode='Cash',date='2026-04-09')
  jv=JournalVoucher.objects.create(date='2026-04-11')
  JournalLine.objects.create(voucher=jv,row=1,side=JournalLine.CREDIT,ledger=self.party_a,amount='200')
  JournalLine.objects.create(voucher=jv,row=1,side=JournalLine.DEBIT,ledger=self.income,amount='200')
  r=self.report(to='2026-04-30')
  self.assertEqual([(e['particulars'],e['reference'][:3],e['debit'],e['credit'],e['balance']) for e in r['entries']],
                   [('Due','D1',Decimal('5000'),0,Decimal('5000')),('Payment','PV-',Decimal('300'),0,Decimal('5300')),('Journal Adjustment','JV-',0,Decimal('200'),Decimal('5100'))])
  from .accounting_reports import ledger_balances
  self.assertEqual(r['closing_balance'],ledger_balances(to_date='2026-04-30')[1][self.party_a.pk])
 def test_ledger_options_lists_linked_and_active_ledgers_only(self):
  from .models import Ledger
  rent=Ledger.objects.create(name='Rent',group='Income')
  Ledger.objects.create(name='Unused Income',group='Income')
  PartyCollection.objects.create(party=rent,account=self.cash,date='2026-04-10',amount='5000',payment_mode='Cash')
  names=[row['name'] for row in self.client.get('/api/finance/party-collections/ledger-options/').data]
  self.assertEqual(names,['Party A','Party B','Rent'])
