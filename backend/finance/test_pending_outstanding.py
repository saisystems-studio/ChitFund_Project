from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer
from .models import ChitGroup, ChitGroupInstallmentDetail, JournalLine, JournalVoucher, Ledger, LoanInstallment, LoanType
from .test_support import ensure_cash_ledger

D = Decimal
URL = '/api/finance/reports/pending-outstanding/'


class PendingOutstandingTests(TestCase):
    def setUp(self):
        ensure_cash_ledger()
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('po-admin', is_staff=True))
        self.chit = LoanType.objects.get_or_create(name='Chit')[0]
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='PO', name='PO Group', duration=2, duration_type='DAY')
        for number in (1, 2):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=number, schedule_value=str(number), installment_amount=10000)
        self.a = self.party('Party A', 'PA001', '9876500101')
        self.b = self.party('Party B', 'PB001', '9876500102')
        self.loan_a = self.loan(self.a)
        self.loan_b = self.loan(self.b)

    def party(self, name, code, phone):
        customer = Customer.objects.create(customer_code=code, full_name=name, primary_mobile=phone, role='BORROWER')
        return Ledger.objects.get(customer=customer)

    def loan(self, ledger):
        response = self.client.post('/api/finance/loans/', {'customer_id': ledger.customer_id, 'loan_type_id': self.chit.pk, 'amount': '20000',
                                                            'start_date': (timezone.localdate() - timedelta(days=10)).isoformat(),
                                                            'chit_group_id': self.group.pk, 'include_sunday': True}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def collect(self, loan, amount, advance=None):
        applied = amount if advance is None else amount - advance
        body = {'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': str(amount),
                'allocations': [{'installment_id': loan['installments'][0]['id'], 'amount': str(applied)}]}
        if advance:
            body['advance_amount'] = str(advance)
        response = self.client.post(f"/api/finance/customer-loan-installments/{loan['installments'][0]['id']}/collect/", body, format='json')
        self.assertEqual(response.status_code, 200, response.data)

    def get(self, **params):
        response = self.client.get(URL, params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_parties_are_linked_ledgers_without_duplicates(self):
        names = [row['name'] for row in self.client.get(URL + 'parties/').data]
        self.assertEqual(sorted(names), ['Party A', 'Party B'])

    def test_multiple_view_shows_due_paid_pending_per_party_and_partial_payment(self):
        self.collect(self.loan_a, 5000)
        data = self.get(view='multiple', basis='due', parties=self.a.pk)
        self.assertEqual([(r['due_amount'], r['paid'], r['pending']) for r in data['rows']], [(D('10000'), D('5000'), D('5000')), (D('10000'), D('0'), D('10000'))])
        self.assertEqual((data['totals']['due'], data['totals']['paid'], data['totals']['pending']), (D('20000'), D('5000'), D('15000')))
        self.assertEqual({r['party_name'] for r in data['rows']}, {'Party A'})
        self.assertEqual(self.get(view='multiple', basis='due')['totals']['pending'], D('35000'))   # Party B independent of A's collection

    def test_fully_paid_dues_drop_out_and_advance_stays_separate(self):
        self.collect(self.loan_a, 10000)
        self.assertEqual([r['pending'] for r in self.get(view='multiple', parties=self.a.pk)['rows']], [D('10000')])
        # Party B pays both dues in full plus 3,000 on account: nothing is pending, and the 3,000 is not pushed onto any due.
        ids = [row['id'] for row in self.loan_b['installments']]
        response = self.client.post(f"/api/finance/customer-loan-installments/{ids[0]}/collect/", {
            'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': '23000', 'advance_amount': '3000',
            'allocations': [{'installment_id': ids[0], 'amount': '10000'}, {'installment_id': ids[1], 'amount': '10000'}]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        after = self.get(view='multiple', parties=self.b.pk)
        self.assertEqual((after['rows'], after['totals']['pending'], after['totals']['unallocated_advance']), ([], D('0'), D('3000')))
        # Partial payment on A stays pending for exactly the remainder.
        second = self.loan_a['installments'][1]['id']
        self.assertEqual(self.client.post(f'/api/finance/customer-loan-installments/{second}/collect/', {'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': '4000',
                                                                                                       'allocations': [{'installment_id': second, 'amount': '4000'}]}, format='json').status_code, 200)
        self.assertEqual(self.get(view='multiple', parties=self.a.pk)['totals']['pending'], D('6000'))

    def test_sorting_overdue_then_party_and_party_wise(self):
        self.collect(self.loan_a, 1000)
        by_overdue = self.get(view='multiple', sort='overdue')['rows']
        self.assertEqual([r['due_date'] for r in by_overdue], sorted(r['due_date'] for r in by_overdue))
        self.assertEqual([r['party_name'] for r in self.get(view='multiple', sort='party')['rows']], ['Party A', 'Party A', 'Party B', 'Party B'])

    def test_date_basis_and_single_date_filters(self):
        first = self.get(view='multiple', basis='due', parties=self.a.pk)['rows'][0]['due_date']
        single = self.get(view='multiple', basis='due', parties=self.a.pk, date=str(first))
        self.assertEqual(len(single['rows']), 1)
        self.assertEqual(self.get(view='multiple', basis='voucher', parties=self.a.pk, **{'from': '2001-01-01', 'to': '2001-01-02'})['rows'], [])

    def test_individual_view_is_a_dr_cr_ledger_with_journal(self):
        self.collect(self.loan_a, 5000)
        voucher = JournalVoucher.objects.create(date=timezone.localdate())
        JournalLine.objects.create(voucher=voucher, row=1, side='DR', ledger=self.a, amount=D('700'))
        JournalLine.objects.create(voucher=voucher, row=1, side='CR', ledger=self.b, amount=D('700'))
        [section] = self.get(view='individual', parties=self.a.pk)['parties']
        self.assertEqual((section['total_debit'], section['total_credit']), (D('20700'), D('5000')))
        self.assertEqual((section['closing'], section['closing_type']), (D('15700'), 'DR'))
        self.assertEqual(section['rows'][-1]['balance'], D('15700'))
        self.assertTrue(all(row['debit'] == 0 or row['credit'] == 0 for row in section['rows']))
        [b] = self.get(view='individual', parties=self.b.pk)['parties']
        self.assertEqual((b['total_debit'], b['total_credit']), (D('20000'), D('700')))

    def test_opening_balance_includes_every_earlier_posting(self):
        self.collect(self.loan_a, 5000)
        full = self.get(view='individual', parties=self.a.pk)['parties'][0]
        later = (timezone.localdate() + timedelta(days=1)).isoformat()
        [section] = self.get(view='individual', basis='voucher', parties=self.a.pk, date=later)['parties']
        self.assertEqual((section['opening'], section['opening_type'], section['rows']), (full['closing'], full['closing_type'], []))

    def test_installment_detail_shows_only_saved_allocations(self):
        self.collect(self.loan_a, 5000)
        response = self.client.get('/api/finance/reports/detail/', {'kind': 'installment', 'id': self.loan_a['installments'][0]['id']})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([c['allocated'] for c in response.data['collections']], [D('5000.00')])
        self.assertEqual(response.data['customer']['name'], 'Party A')
        self.assertEqual(self.client.get('/api/finance/reports/detail/', {'kind': 'installment', 'id': 999999}).status_code, 404)

    def test_bad_dates_are_rejected(self):
        self.assertEqual(self.client.get(URL, {'from': '2026-05-02', 'to': '2026-05-01'}).status_code, 400)
        self.assertEqual(self.client.get(URL, {'from': 'x'}).status_code, 400)
