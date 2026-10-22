"""Journal Entry: balanced vouchers posting through the shared ledger balances and statements."""
import uuid
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .accounting_reports import ledger_balances, profit_and_loss, trial_balance
from .models import JournalAudit, JournalLine, JournalVoucher, Ledger

D = Decimal
URL = '/api/finance/journal-vouchers/'


class JournalEntryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('journal-admin', is_staff=True))
        self.bank = Ledger.objects.create(name='Bank', group='Bank Accounts', bank_name='KVB', branch_name='Main', ifsc_code='KVBL0001234', account_number='123456789')
        self.cash = Ledger.objects.create(name='Cash', group='Cash-in-Hand')
        self.kumar = Ledger.objects.create(name='Kumar', group='Sundry Debtors', collection_type='CONSOLIDATED')
        self.income = Ledger.objects.create(name='Due Income', group='Income')
        # Journals refuse Cash / Bank ledgers, so these stand in for them where a journal needs two parties.
        self.jbank = Ledger.objects.create(name='Bank J', group='Sundry Creditors')
        self.jcash = Ledger.objects.create(name='Cash J', group='Direct Expense')
        self.expense = Ledger.objects.create(name='Office Expense', group='Indirect Expense')

    def post(self, rows, on='2026-04-10', **extra):
        return self.client.post(URL, {'date': on, 'narration': 'Adjustment', 'rows': rows, **extra}, format='json')

    def row(self, cr=None, cr_amount='', dr=None, dr_amount=''):
        return {'cr_ledger': cr.pk if cr else '', 'cr_amount': cr_amount, 'dr_ledger': dr.pk if dr else '', 'dr_amount': dr_amount}

    def statement(self, **params):
        response = self.client.get('/api/finance/reports/ledger/', params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_bank_to_kumar_journal_posts_both_ledgers_and_reports(self):
        preview = self.client.get(f'{URL}next-voucher/').data['voucher_no']
        response = self.post([self.row(self.jbank, '5000', self.kumar, '5000')])
        self.assertEqual(response.status_code, 201, response.data)
        number = response.data['voucher_no']
        self.assertEqual((number, number), (preview, JournalVoucher.format_voucher(response.data['id'])))
        self.assertEqual(response.data['total'], D('5000.00'))
        self.assertEqual(response.data['rows'][0]['cr_ledger_name'], 'Bank J')
        _, balances, suspense = ledger_balances()
        self.assertEqual((balances[self.kumar.pk], balances[self.jbank.pk], suspense), (D('5000'), D('-5000'), 0))
        totals = trial_balance()
        self.assertEqual(totals['total_debit'], totals['total_credit'])
        bank = self.statement(type='ledger', ledger=self.jbank.pk)
        self.assertEqual([(row['reference'], row['type'], row['credit']) for row in bank['rows']], [(number, 'Journal', D('5000.00'))])
        kumar = self.statement(type='ledger', ledger=self.kumar.pk)
        self.assertEqual((kumar['rows'][0]['debit'], kumar['closing_balance'], kumar['closing_balance_type']), (D('5000.00'), D('5000.00'), 'DR'))
        self.assertEqual(self.client.get(f'{URL}next-voucher/').data['voucher_no'], JournalVoucher.format_voucher(response.data['id'] + 1))
        # A journal is never a Today Report collection.
        self.assertFalse(self.client.get('/api/finance/reports/today/', {'from': '2026-04-10', 'to': '2026-04-10'}).data['rows'])

    def test_validation_rejects_unbalanced_and_invalid_vouchers(self):
        bad = [
            [self.row(self.jbank, '5000', self.kumar, '4000')],              # unbalanced
            [self.row(self.jbank, '0', self.kumar, '0')],                    # zero voucher
            [self.row(None, '100', self.kumar, '100')],                     # credit amount without ledger
            [self.row(self.jbank, '', self.kumar, '100')],                   # credit ledger without amount
            [self.row(self.jbank, '-100', self.kumar, '-100')],              # negative
            [self.row(self.jbank, '10.555', self.kumar, '10.555')],          # 3 decimals
            [self.row(self.kumar, '100', self.kumar, '100')],               # same ledger both sides
            [self.row(dr=self.kumar, dr_amount='100')],                     # no credit side
            [{'cr_ledger': 999999, 'cr_amount': '100', 'dr_ledger': self.kumar.pk, 'dr_amount': '100'}],
            [],
        ]
        for rows in bad:
            response = self.post(rows)
            self.assertEqual(response.status_code, 400, rows)
            self.assertIn('detail', response.data)
        self.assertEqual(self.post([self.row(self.jbank, '1', self.kumar, '1')], on='').status_code, 400)
        self.assertFalse(JournalVoucher.objects.exists())

    def test_compound_voucher_balances_across_rows_and_skips_blank_rows(self):
        rows = [self.row(self.jbank, '7000', self.kumar, '5000'), self.row(dr=self.expense, dr_amount='2000'), self.row()]
        response = self.post(rows)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(response.data['rows']), 2)
        self.assertEqual(JournalLine.objects.count(), 3)
        pl = profit_and_loss()
        self.assertEqual(pl['net_profit'], D('-2000.00'))
        _, balances, _ = ledger_balances()
        self.assertEqual((balances[self.jbank.pk], balances[self.kumar.pk], balances[self.expense.pk]), (D('-7000'), D('5000'), D('2000')))

    def test_repeated_save_with_same_token_posts_once(self):
        token = str(uuid.uuid4())
        first = self.post([self.row(self.jbank, '5000', self.kumar, '5000')], client_token=token)
        again = self.post([self.row(self.jbank, '5000', self.kumar, '5000')], client_token=token)
        self.assertEqual((first.status_code, again.status_code), (201, 200))
        self.assertEqual(first.data['id'], again.data['id'])
        self.assertEqual(JournalVoucher.objects.count(), 1)
        self.assertEqual(JournalLine.objects.count(), 2)

    def test_edit_reposts_delete_reverses_and_audit_is_kept(self):
        voucher = self.post([self.row(self.jbank, '5000', self.kumar, '5000')]).data
        url = f"{URL}{voucher['id']}/"
        self.assertEqual(self.client.put(url, {'date': '2026-04-11', 'narration': 'Corrected', 'rows': [self.row(self.jcash, '3000', self.kumar, '3000')]}, format='json').status_code, 200)
        self.assertEqual(self.client.put(url, {'date': '2026-04-11', 'rows': [self.row(self.jcash, '3000', self.kumar, '2000')]}, format='json').status_code, 400)
        _, balances, _ = ledger_balances()
        self.assertEqual((balances[self.jbank.pk], balances[self.jcash.pk], balances[self.kumar.pk]), (0, D('-3000'), D('3000')))
        self.assertEqual(self.client.get(url).data['narration'], 'Corrected')
        self.assertEqual(self.client.delete(url).status_code, 204)
        _, balances, _ = ledger_balances()
        self.assertEqual((balances[self.jcash.pk], balances[self.kumar.pk]), (0, 0))
        self.assertEqual(list(JournalAudit.objects.filter(voucher_id=voucher['id']).order_by('id').values_list('action', flat=True)), ['CREATE', 'UPDATE', 'DELETE'])
        # A ledger used in a journal cannot be deleted while the voucher exists.
        other = self.post([self.row(self.jbank, '10', self.kumar, '10')]).data
        self.assertEqual(self.client.delete(f'/api/finance/ledgers/{self.kumar.pk}/').status_code, 409)
        self.assertEqual(self.client.get(f"{URL}{other['id']}/audit/").data[0]['action'], 'Created')

    def test_list_search_date_filter_and_pagination(self):
        first = self.post([self.row(self.jbank, '100', self.kumar, '100')], on='2026-04-01').data['voucher_no']
        second = self.post([self.row(self.jcash, '200', self.expense, '200')], on='2026-04-05').data['voucher_no']
        listing = self.client.get(URL).data
        self.assertEqual(listing['count'], 2)
        self.assertEqual([row['voucher_no'] for row in listing['results']], [second, first])
        self.assertEqual(self.client.get(URL, {'search': 'kumar'}).data['count'], 1)
        self.assertEqual(self.client.get(URL, {'search': second}).data['results'][0]['total'], D('200.00'))
        self.assertEqual(self.client.get(URL, {'from': '2026-04-02', 'to': '2026-04-30'}).data['count'], 1)
        self.assertEqual(self.client.get(URL, {'page_size': 1}).data['count'], 2)
        self.assertEqual(len(self.client.get(URL, {'page_size': 1}).data['results']), 1)
        self.assertEqual(self.client.get(URL, {'from': '2026-04-30', 'to': '2026-04-01'}).status_code, 400)

    def test_kumar_ledger_statement_with_dues_collection_and_journal(self):
        for number, on in (('1st Due', '2026-04-01'), ('2nd Due', '2026-04-02')):
            self.assertEqual(self.client.post('/api/finance/party-dues/', {'party': self.kumar.pk, 'counter_ledger': self.income.pk, 'due_date': on,
                                                                           'due_number': number, 'amount': '10000'}, format='json').status_code, 201)
        self.assertEqual(self.client.post('/api/finance/party-collections/', {'party': self.kumar.pk, 'account': self.cash.pk, 'payment_mode': 'Cash',
                                                                              'date': '2026-04-07', 'amount': '5000'}, format='json').status_code, 201)
        self.assertEqual(self.post([self.row(self.income, '5000', self.kumar, '5000')]).status_code, 201)
        data = self.statement(type='ledger', ledger=self.kumar.pk)
        self.assertEqual([(row['date'].isoformat() if hasattr(row['date'], 'isoformat') else row['date'], row['particulars'].split(' (')[0], row['debit'], row['credit']) for row in data['rows']], [
            ('2026-04-01', '1st Due', D('10000'), D('0')), ('2026-04-02', '2nd Due', D('10000'), D('0')),
            ('2026-04-07', 'Collection · Cash', D('0'), D('5000')), ('2026-04-10', 'Journal · Due Income', D('5000'), D('0'))])
        self.assertEqual((data['total_debit'], data['total_credit'], data['closing_balance'], data['closing_balance_type']), (D('25000'), D('5000'), D('20000'), 'DR'))
        summary = self.client.get('/api/finance/party-collections/summary/', {'party': self.kumar.pk}).data
        self.assertEqual((summary['outstanding'], summary['outstanding_type']), (D('20000.00'), 'DR'))
        self.assertEqual(self.client.get('/api/finance/reports/ledger/', {'type': 'ledger', 'ledger': 'x'}).status_code, 400)

    def test_kumar_credit_kvb_debit_end_to_end(self):
        kvb = self.jbank
        token = str(uuid.uuid4())
        saved = self.post([self.row(self.kumar, '5000', kvb, '5000')], client_token=token)
        self.assertEqual(saved.status_code, 201, saved.data)
        self.assertEqual(saved.data['rows'][0], {'cr_ledger': self.kumar.pk, 'cr_ledger_name': 'Kumar', 'cr_amount': D('5000.00'),
                                                 'dr_ledger': kvb.pk, 'dr_ledger_name': 'Bank J', 'dr_amount': D('5000.00')})
        # Double-click / retry of the same Save: same voucher, no second posting.
        self.assertEqual(self.post([self.row(self.kumar, '5000', kvb, '5000')], client_token=token).data['id'], saved.data['id'])
        self.assertEqual(JournalVoucher.objects.count(), 1)
        listing = self.client.get(URL).data
        self.assertEqual([(row['voucher_no'], row['total']) for row in listing['results']], [(saved.data['voucher_no'], D('5000.00'))])
        kumar = self.statement(type='ledger', ledger=self.kumar.pk)
        self.assertEqual((kumar['total_credit'], kumar['closing_balance'], kumar['closing_balance_type']), (D('5000.00'), D('5000.00'), 'CR'))
        bank = self.statement(type='ledger', ledger=kvb.pk)
        self.assertEqual((bank['total_debit'], bank['closing_balance'], bank['closing_balance_type']), (D('5000.00'), D('5000.00'), 'DR'))
        totals = trial_balance()
        self.assertEqual(totals['total_debit'], totals['total_credit'])
        # Malformed input is a 400 with a message, never a 500.
        for payload in ({'date': 'x', 'rows': []}, {'date': '2026-04-10', 'rows': 'abc'}, {'date': '2026-04-10', 'rows': [{'cr_ledger': 'abc', 'cr_amount': 'x'}]},
                        {'date': '2026-04-10', 'rows': [self.row(self.kumar, '1e20', kvb, '1e20')]}, {'client_token': 'not-a-uuid', 'date': '2026-04-10', 'rows': []}):
            response = self.client.post(URL, payload, format='json')
            self.assertEqual(response.status_code, 400, payload)
            self.assertIn('detail', response.data)
        self.assertEqual(self.client.get(f'{URL}999999/').status_code, 404)

    def test_cash_and_bank_ledgers_are_refused_on_either_side_but_old_vouchers_stay_editable(self):
        child = Ledger.objects.create(name='Petty', group='Cash-in-Hand')
        for rows in ([self.row(self.cash, '10', self.kumar, '10')], [self.row(self.kumar, '10', self.bank, '10')], [self.row(self.kumar, '10', child, '10')]):
            response = self.post(rows)
            self.assertEqual(response.status_code, 400, rows)
            self.assertIn('Cash / Bank', response.data['detail'])
        self.assertEqual(JournalVoucher.objects.count(), 0)
        self.assertEqual(self.post([self.row(self.kumar, '10', self.income, '10')]).status_code, 201)
        # A voucher saved before this rule that already posts to Cash can be corrected, but not pointed at another account ledger.
        old = JournalVoucher.objects.create(date='2026-04-01')
        JournalLine.objects.create(voucher=old, row=1, side='CR', ledger=self.kumar, amount=D('5'))
        JournalLine.objects.create(voucher=old, row=1, side='DR', ledger=self.cash, amount=D('5'))
        url = f'{URL}{old.pk}/'
        self.assertEqual(self.client.put(url, {'date': '2026-04-01', 'rows': [self.row(self.kumar, '6', self.cash, '6')]}, format='json').status_code, 200)
        self.assertEqual(self.client.put(url, {'date': '2026-04-01', 'rows': [self.row(self.kumar, '6', self.bank, '6')]}, format='json').status_code, 400)

