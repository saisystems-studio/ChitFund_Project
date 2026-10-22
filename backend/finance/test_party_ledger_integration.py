"""Customer <-> Party Ledger binding, View Statement allocation, general-ledger collection,
Party A / Party B collection and the Customer-wise Report built on the linked ledger."""
from decimal import Decimal

from django.contrib.auth.models import User
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer
from .accounting_reports import ledger_balances
from .models import (ChitGroup, ChitGroupInstallmentDetail, CollectionAllocation, CollectionTransaction,
                     CustomerLoanInstallmentDetails, Group, Ledger, LoanInstallment, LoanType, PartyCollection)

D = Decimal


class PartyLedgerIntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('party-admin', is_staff=True))
        self.debtors = Group.objects.create(name='Sundry Debtors', is_system=True, nature='ASSET')
        self.creditors = Group.objects.create(name='Sundry Creditors', is_system=True, nature='LIABILITY')
        self.cash = Ledger.objects.create(name='CASH', group='Cash-in-Hand')
        self.bank = Ledger.objects.create(name='KVB', group='Bank Accounts', bank_name='KVB', branch_name='Main', ifsc_code='KVBL0001234', account_number='123456789')
        self.income = Ledger.objects.create(name='Due Income', group='Income')

    def add_customer(self, name, phone, group=None):
        payload = {'full_name': name, 'primary_mobile': phone, 'group': (group or self.debtors).pk, 'address': '12 Main Street',
                   'district': 'Karur', 'state': 'Tamil Nadu', 'country': 'India'}
        response = self.client.post('/api/customers/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    # ---- Task 1: Customer Master <-> Ledger Master ----
    def test_direct_add_customer_creates_one_linked_ledger_with_zero_opening(self):
        data = self.add_customer('Kumar', '9876500001')
        ledgers = Ledger.objects.filter(customer_id=data['id'])
        self.assertEqual(ledgers.count(), 1)
        ledger = ledgers.get()
        self.assertEqual((ledger.name, ledger.group, ledger.group_detail_id, ledger.opening_balance), ('Kumar', 'Sundry Debtors', self.debtors.pk, D('0')))
        self.assertEqual(data['ledger_id'], ledger.pk)
        listed = self.client.get('/api/finance/ledgers/').data
        self.assertEqual([row['name'] for row in listed].count('Kumar'), 1)
        self.assertEqual(next(row for row in listed if row['id'] == ledger.pk)['customer_name'], 'Kumar')

    def test_resaving_or_regrouping_customer_never_duplicates_its_ledger(self):
        data = self.add_customer('Kumar', '9876500001')
        self.client.patch(f"/api/customers/{data['id']}/", {'full_name': 'Kumar Raj', 'group': self.creditors.pk}, format='json')
        ledger = Ledger.objects.get(customer_id=data['id'])
        self.assertEqual((ledger.name, ledger.group, ledger.group_detail_id), ('Kumar Raj', 'Sundry Creditors', self.creditors.pk))
        with self.assertRaises(IntegrityError), transaction.atomic():
            Ledger.objects.create(name='Kumar copy', group='Sundry Debtors', customer_id=data['id'])

    def test_ledger_first_flow_completes_the_same_ledger(self):
        # Add Ledger -> Add Customer (group carried by id) -> back to Ledger -> final Save.
        customer = self.add_customer('Sai', '9876500002')
        ledger_id = customer['ledger_id']
        response = self.client.put(f'/api/finance/ledgers/{ledger_id}/', {'name': 'Sai', 'group_detail': self.debtors.pk, 'opening_balance': '-750',
                                                                          'collection_type': 'DUE_WISE'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Ledger.objects.filter(name='Sai').count(), 1)
        ledger = Ledger.objects.get(pk=ledger_id)
        self.assertEqual((ledger.customer_id, ledger.opening_balance, ledger.collection_type), (customer['id'], D('-750'), 'DUE_WISE'))
        # The API can never re-point the link at another customer.
        other = self.add_customer('Ravi', '9876500003')
        self.client.patch(f'/api/finance/ledgers/{ledger_id}/', {'customer': other['id']}, format='json')
        self.assertEqual(Ledger.objects.get(pk=ledger_id).customer_id, customer['id'])

    def test_editing_linked_ledger_updates_customer_and_delete_is_blocked(self):
        customer = self.add_customer('Sai', '9876500002')
        ledger_id = customer['ledger_id']
        self.assertEqual(self.client.patch(f'/api/finance/ledgers/{ledger_id}/', {'name': 'Sai Kumar'}, format='json').status_code, 200)
        self.assertEqual(Customer.objects.get(pk=customer['id']).full_name, 'Sai Kumar')
        self.assertEqual(self.client.patch(f'/api/finance/ledgers/{ledger_id}/', {'name': 'Sai & Co'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(f'/api/finance/ledgers/{ledger_id}/', {'group_detail': Group.objects.create(name='Indirect Income', is_system=True, nature='INCOME').pk}, format='json').status_code, 400)
        self.assertEqual(self.client.delete(f'/api/finance/ledgers/{ledger_id}/').status_code, 409)
        self.assertTrue(Ledger.objects.filter(pk=ledger_id).exists())

    def test_normal_ledgers_never_become_customers(self):
        before = Customer.objects.count()
        self.assertEqual(self.client.post('/api/finance/ledgers/', {'name': 'Rent', 'group': 'Income'}, format='json').status_code, 201)
        self.assertEqual(Customer.objects.count(), before)

    # ---- Tasks 4/5: Collection Entry View Statement allocation ----
    def make_loan(self, customer_id, amounts=(6000, 1000, 5000)):
        loan_type = LoanType.objects.get_or_create(name='Chit')[0]
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        group = ChitGroup.objects.create(code=f'ALC{ChitGroup.objects.count()}', name='Alloc Group', duration=len(amounts), duration_type='DAY')
        for number, amount in enumerate(amounts, start=1):
            ChitGroupInstallmentDetail.objects.create(group=group, installment_number=number, schedule_value=str(number), installment_amount=amount)
        response = self.client.post('/api/finance/loans/', {'customer_id': customer_id, 'loan_type_id': loan_type.pk, 'amount': str(sum(amounts)),
                                                            'start_date': timezone.localdate().isoformat(), 'chit_group_id': group.pk, 'include_sunday': True}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def collect(self, loan, amount, allocations, **extra):
        return self.client.post(f"/api/finance/customer-loan-installments/{loan['installments'][0]['id']}/collect/",
                                {'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': amount, 'payment_mode': 'Cash',
                                 'account_id': self.cash.pk, 'allocations': allocations, **extra}, format='json')

    def test_partial_collection_goes_only_to_the_chosen_installment(self):
        customer = self.add_customer('Kumar', '9876500001')
        loan = self.make_loan(customer['id'])
        rows = sorted(loan['installments'], key=lambda row: row['installment_number'])
        third = rows[2]
        response = self.collect(loan, '4000', [{'installment_id': third['id'], 'amount': '4000'}])
        self.assertEqual(response.status_code, 200, response.data)
        paid = {row.installment_number: row.paid_amount for row in CustomerLoanInstallmentDetails.objects.filter(loan_id=loan['id'])}
        self.assertEqual(paid, {1: D('0'), 2: D('0'), 3: D('4000')})
        receipt = CollectionTransaction.objects.get()
        self.assertEqual((receipt.account_id, receipt.party_ledger_id), (self.cash.pk, customer['ledger_id']))
        _, balances, _ = ledger_balances()
        self.assertEqual((balances[self.cash.pk], balances[customer['ledger_id']]), (D('4000'), D('-4000')))
        # Next time: 1,000 still pending on that installment, not the original amount.
        third_row = CustomerLoanInstallmentDetails.objects.get(pk=third['id'])
        self.assertEqual(third_row.installment_amount - third_row.paid_amount, D('1000'))

    def test_allocation_rules_are_enforced(self):
        customer = self.add_customer('Kumar', '9876500001')
        loan = self.make_loan(customer['id'])
        first = loan['installments'][0]
        foreign = self.make_loan(self.add_customer('Ravi', '9876500003')['id'])['installments'][0]
        for amount, allocations in (('7000', [{'installment_id': first['id'], 'amount': '7000'}]),   # above pending
                                    ('5000', [{'installment_id': first['id'], 'amount': '4000'}]),   # does not add up
                                    ('100', [{'installment_id': foreign['id'], 'amount': '100'}]),  # another customer's loan
                                    ('200', [{'installment_id': first['id'], 'amount': '100'}, {'installment_id': first['id'], 'amount': '100'}])):
            self.assertEqual(self.collect(loan, amount, allocations).status_code, 400, allocations)
        self.assertFalse(CollectionTransaction.objects.exists())

    def test_editing_a_receipt_keeps_its_chosen_allocation(self):
        customer = self.add_customer('Kumar', '9876500001')
        loan = self.make_loan(customer['id'])
        second = next(row for row in loan['installments'] if row['installment_number'] == 2)
        self.assertEqual(self.collect(loan, '1000', [{'installment_id': second['id'], 'amount': '1000'}]).status_code, 200)
        receipt = CollectionTransaction.objects.get()
        response = self.client.patch(f'/api/finance/collection-transactions/{receipt.pk}/', {'collection_amount': '600'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(list(CollectionAllocation.objects.values_list('installment_id', 'amount')), [(second['id'], D('600'))])

    # ---- Scenario B: ledger without loans ----
    def test_general_ledger_collection_posts_dr_cash_cr_ledger(self):
        rent = Ledger.objects.create(name='Rent', group='Income')
        response = self.client.post('/api/finance/party-collections/', {'party': rent.pk, 'date': '2026-04-07', 'amount': '2500', 'account': self.bank.pk,
                                                                      'payment_mode': 'NEFT', 'transaction_utr': 'UTR1', 'bank_name': 'KVB'}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        _, balances, _ = ledger_balances()
        self.assertEqual((balances[self.bank.pk], balances[rent.pk]), (D('2500'), D('-2500')))
        bad = self.client.post('/api/finance/party-collections/', {'party': self.cash.pk, 'date': '2026-04-07', 'amount': '1', 'account': self.bank.pk,
                                                                 'payment_mode': 'NEFT', 'transaction_utr': 'U', 'bank_name': 'B'}, format='json')
        self.assertEqual(bad.status_code, 400)

    # ---- Task 6/7: Party A (due-wise) and Party B (consolidated) ----
    def dues(self, party):
        for number, day in (('First Due', '2026-04-01'), ('Second Due', '2026-04-02')):
            response = self.client.post('/api/finance/party-dues/', {'party': party.pk, 'counter_ledger': self.income.pk, 'due_date': day,
                                                                   'due_number': number, 'amount': '10000'}, format='json')
            self.assertEqual(response.status_code, 201, response.data)
        return {row['due_number']: row['id'] for row in self.client.get('/api/finance/party-dues/', {'party': party.pk}).data}

    def receipt(self, party, **extra):
        return self.client.post('/api/finance/party-collections/', {'party': party.pk, 'date': '2026-04-07', 'amount': '5000', 'account': self.cash.pk,
                                                                  'payment_mode': 'Cash', **extra}, format='json')

    def test_party_a_due_wise_allocation_and_others_advance(self):
        party = Ledger.objects.create(name='Party A', group='Sundry Debtors', collection_type='DUE_WISE')
        ids = self.dues(party)
        self.assertEqual(self.receipt(party, allocations=[{'due': ids['First Due'], 'amount': '5000'}]).status_code, 201)
        summary = self.client.get('/api/finance/party-collections/summary/', {'party': party.pk}).data
        pending = {row['due_number']: row['pending'] for row in summary['dues']}
        self.assertEqual(pending, {'First Due': D('5000'), 'Second Due': D('10000')})
        self.assertEqual((summary['total_pending'], summary['outstanding'], summary['outstanding_type']), (D('15000'), D('15000'), 'DR'))
        # Others: an advance that never marks a due as paid.
        self.assertEqual(self.receipt(party, advance_amount='5000').status_code, 201)
        summary = self.client.get('/api/finance/party-collections/summary/', {'party': party.pk}).data
        self.assertEqual((summary['total_pending'], summary['unallocated_advance'], summary['outstanding']), (D('15000'), D('5000'), D('10000')))
        # Allocating it later moves no Cash: still two receipts, same Cash balance.
        self.assertEqual(self.client.post('/api/finance/party-collections/allocate-advance/', {'party': party.pk, 'allocations': [{'due': ids['First Due'], 'amount': '5000'}]}, format='json').status_code, 201)
        self.assertEqual(PartyCollection.objects.filter(party=party).count(), 2)
        _, balances, _ = ledger_balances()
        self.assertEqual(balances[self.cash.pk], D('10000'))

    def test_party_b_consolidated_others_reduces_outstanding(self):
        party = Ledger.objects.create(name='Party B', group='Sundry Debtors', collection_type='CONSOLIDATED')
        ids = self.dues(party)
        self.assertEqual(self.receipt(party, allocations=[{'due': ids['First Due'], 'amount': '5000'}]).status_code, 400)
        self.assertEqual(self.receipt(party).status_code, 201)
        summary = self.client.get('/api/finance/party-collections/summary/', {'party': party.pk}).data
        self.assertNotIn('dues', summary)
        self.assertEqual((summary['total_due'], summary['total_received'], summary['outstanding'], summary['outstanding_type']), (D('20000'), D('5000'), D('15000'), 'DR'))

    # ---- Task 2: Customer-wise Report on the linked Party Ledger ----
    def test_customer_wise_report_includes_linked_ledger_postings(self):
        customer = self.add_customer('Kumar', '9876500001')
        party = Ledger.objects.get(pk=customer['ledger_id'])
        party.collection_type = 'DUE_WISE'
        party.save()
        ids = self.dues(party)
        self.assertEqual(self.receipt(party, allocations=[{'due': ids['First Due'], 'amount': '5000'}]).status_code, 201)
        journal = self.client.post('/api/finance/journal-vouchers/', {'date': '2026-04-08', 'narration': 'Adjustment',
                                    'rows': [{'cr_ledger': self.bank.pk, 'cr_amount': '500', 'dr_ledger': party.pk, 'dr_amount': '500'}]}, format='json')
        self.assertEqual(journal.status_code, 201, journal.data)
        data = self.client.get('/api/finance/reports/customer-wise/', {'customer': customer['id'], 'from': '2026-04-01', 'to': '2026-04-30'}).data
        rows = data['results'][0]['rows']
        self.assertEqual([(row['voucher_type'], row['debit'], row['credit']) for row in rows[1:]],
                         [('Party Due', D('10000'), D('0')), ('Party Due', D('10000'), D('0')), ('Receipt', D('0'), D('5000')), ('Journal', D('500'), D('0'))])
        totals = data['results'][0]['totals']
        self.assertEqual(totals['debit'] - totals['credit'], D('15500'))

    def test_ledger_edit_without_collection_type_keeps_the_saved_value(self):
        # Ledger Master no longer shows or sends Collection Type; a party's saved value stays.
        party = Ledger.objects.create(name='Party A', group='Sundry Debtors', group_detail=self.debtors, collection_type='DUE_WISE')
        response = self.client.put(f'/api/finance/ledgers/{party.pk}/', {'name': 'Party A1', 'group_detail': self.debtors.pk, 'opening_balance': '250'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        party.refresh_from_db()
        self.assertEqual((party.name, party.opening_balance, party.collection_type), ('Party A1', D('250'), 'DUE_WISE'))
