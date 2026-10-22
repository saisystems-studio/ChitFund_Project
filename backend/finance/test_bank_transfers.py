from decimal import Decimal
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient
from accounts.models import UserProfile
from .models import Ledger
from .accounting_reports import ledger_balances

class BankTransferTests(TestCase):
    def setUp(self):
        self.client=APIClient()
        self.admin=User.objects.create_user('transfer-admin',is_staff=True)
        self.client.force_authenticate(self.admin)
        self.cash=Ledger.objects.create(name='Cash',group='Cash-in-Hand',opening_balance=1000)
        self.bank=Ledger.objects.create(name='Bank',group='Bank Accounts',opening_balance=500)
        self.other=Ledger.objects.create(name='Income',group='Income')
        self.url='/api/finance/bank-transfers/'

    def payload(self,kind='DEPOSIT',amount='200'):
        source,target=(self.cash,self.bank) if kind=='DEPOSIT' else (self.bank,self.cash)
        return dict(transaction_type=kind,date='2026-10-12',from_account=source.pk,to_account=target.pk,amount=amount,payment_mode='Cash',reference_no='REF-01',notes='Transfer')

    def create(self,kind='DEPOSIT',amount='200'):
        response=self.client.post(self.url,self.payload(kind,amount),format='json')
        self.assertEqual(response.status_code,201,response.data)
        return response.data

    def test_full_flow_reaches_cash_bank_ledgers_and_today_report_once(self):
        from .accounting_reports import profit_and_loss
        second=Ledger.objects.create(name='Bank Two',group='Bank Accounts')
        deposit=self.create()
        withdrawal=self.create('WITHDRAWAL','50')
        transfer=self.client.post(self.url,dict(transaction_type='TRANSFER',date='2026-10-12',from_account=self.bank.pk,to_account=second.pk,amount='100',payment_mode='NEFT'),format='json')
        self.assertEqual(transfer.status_code,201,transfer.data)
        _,balances,suspense=ledger_balances()
        self.assertEqual((balances[self.cash.pk],balances[self.bank.pk],balances[second.pk],suspense),(Decimal('850'),Decimal('550'),Decimal('100'),0))
        # Internal transfers are never Income or Expense.
        pl=profit_and_loss()
        self.assertEqual((pl['gross_profit'],pl['net_profit']),(0,0))
        # Edit moves the postings; delete reverses them.
        self.assertEqual(self.client.patch(f"{self.url}{deposit['id']}/",{'amount':'300'},format='json').status_code,200)
        self.assertEqual(self.client.delete(f"{self.url}{withdrawal['id']}/").status_code,204)
        _,balances,_=ledger_balances()
        self.assertEqual((balances[self.cash.pk],balances[self.bank.pk],balances[second.pk]),(Decimal('700'),Decimal('700'),Decimal('100')))
        response=self.client.get('/api/finance/reports/ledger/',{'type':'bank'})
        self.assertEqual(str(response.data['closing_balance']),'800.00')
        # Today Report: one row per transfer, Cash/Bank from the accounts, counted once in totals.
        report=self.client.get('/api/finance/reports/today/',{'from':'2026-10-12','to':'2026-10-12'}).data
        rows=[row for row in report['rows'] if row['transaction_type']=='Bank Transaction']
        self.assertEqual(sorted((row['voucher_no'],row['particulars'],row['account_type'],str(row['amount'])) for row in rows),
                         sorted([(deposit['voucher_no'],'Cash → Bank','Cash','300.00'),(transfer.data['voucher_no'],'Bank → Bank Two','Bank','100.00')]))
        self.assertEqual(report['totals']['Bank Transaction'],{'count':2,'amount':Decimal('400.00')})
        self.assertFalse(self.client.get('/api/finance/reports/today/',{'from':'2026-10-11','to':'2026-10-11'}).data['rows'])
        self.assertFalse([row for row in self.client.get('/api/finance/reports/today/',{'from':'2026-10-12','to':'2026-10-12','loan_type':'Chit'}).data['rows'] if row['transaction_type']=='Bank Transaction'])

    def test_deposit_withdrawal_post_balanced_legs_without_changing_openings(self):
        deposit=self.create()
        withdrawal=self.create('WITHDRAWAL','50')
        self.assertNotEqual(deposit['voucher_no'],withdrawal['voucher_no'])
        _,balances,suspense=ledger_balances()
        self.assertEqual((balances[self.cash.pk],balances[self.bank.pk],suspense),(Decimal('850'),Decimal('650'),0))
        self.cash.refresh_from_db()
        self.assertEqual(self.cash.opening_balance,1000)
        for kind,closing in [('cash','850.00'),('bank','650.00')]:
            response=self.client.get('/api/finance/reports/ledger/',{'type':kind})
            self.assertEqual(str(response.data['closing_balance']),closing)
            self.assertEqual(len(response.data['rows']),2)
        _,balances,_=ledger_balances(to_date='2026-10-11')
        self.assertEqual(balances[self.cash.pk],1000)

    def test_edit_delete_reopen_and_history_filters(self):
        saved=self.create()
        detail=f"{self.url}{saved['id']}/"
        response=self.client.patch(detail,self.payload('WITHDRAWAL','80'),format='json')
        self.assertEqual(response.status_code,200,response.data)
        reopened=self.client.get(detail).data
        self.assertEqual((reopened['from_account'],reopened['to_account']),(self.bank.pk,self.cash.pk))
        self.assertEqual(reopened['voucher_no'],saved['voucher_no'])
        _,balances,_=ledger_balances()
        self.assertEqual((balances[self.cash.pk],balances[self.bank.pk]),(1080,420))
        data=self.client.get(self.url,{'transaction_type':'DEPOSIT'}).data
        self.assertEqual(data['count'],0)
        data=self.client.get(self.url,{'search':'REF-01','from':'2026-10-12','to':'2026-10-12'}).data
        self.assertEqual(data['count'],1)
        self.assertEqual(self.client.delete(detail).status_code,204)
        _,balances,_=ledger_balances()
        self.assertEqual((balances[self.cash.pk],balances[self.bank.pk]),(1000,500))

    def test_validation_and_permissions(self):
        for patch in [{'amount':'0'},{'amount':'-1'},{'from_account':self.bank.pk},{'to_account':self.cash.pk},{'to_account':self.other.pk},{'date':'invalid'},{'transaction_type':'OTHER'}]:
            response=self.client.post(self.url,{**self.payload(),**patch},format='json')
            self.assertEqual(response.status_code,400,response.data)
        self.assertEqual(self.client.get(self.url,{'from':'2026-10-13','to':'2026-10-12'}).status_code,400)
        writer=User.objects.create_user('transfer-writer')
        UserProfile.objects.create(user=writer,can_write=True)
        self.client.force_authenticate(writer)
        saved=self.create()
        self.assertEqual(self.client.patch(f"{self.url}{saved['id']}/",{'amount':'20'},format='json').status_code,403)
        self.assertEqual(self.client.delete(f"{self.url}{saved['id']}/").status_code,403)
        reader=User.objects.create_user('transfer-reader')
        self.client.force_authenticate(reader)
        self.assertEqual(self.client.post(self.url,self.payload(),format='json').status_code,403)
        self.assertEqual(self.client.get(self.url).status_code,200)


class BankTransactionScenarioTests(TestCase):
    """FROM = money out = Credit (−); TO = money in = Debit (+); totals unchanged."""
    def setUp(self):
        self.client=APIClient()
        self.client.force_authenticate(User.objects.create_user('bank-txn-admin',is_staff=True))
        self.cash=Ledger.objects.create(name='CASH',group='Cash-in-Hand',opening_balance=10000)
        self.kvb=Ledger.objects.create(name='KVB',group='Bank Accounts',opening_balance=20000)
        self.sbi=Ledger.objects.create(name='SBI',group='Bank Accounts',opening_balance=5000)
        self.url='/api/finance/bank-transfers/'

    def post(self,kind,source,target,amount,mode):
        return self.client.post(self.url,dict(transaction_type=kind,date='2026-10-12',from_account=source.pk,to_account=target.pk,amount=amount,payment_mode=mode),format='json')

    def balances(self):
        _,balances,suspense=ledger_balances()
        self.assertEqual(suspense,0)
        return balances[self.cash.pk],balances[self.kvb.pk],balances[self.sbi.pk]

    def trial_gap(self):
        trial=self.client.get('/api/finance/reports/trial-balance/').data
        return Decimal(str(trial['total_debit']))-Decimal(str(trial['total_credit']))

    def test_four_examples_move_money_from_credit_to_debit(self):
        total=sum(self.balances())
        # The fixture's openings are unreconciled (no capital ledger); every transfer adds an
        # equal Dr and Cr, so the Trial Balance difference must not move at all.
        gap=self.trial_gap()
        for kind,source,target,amount,mode,expected in [
                ('DEPOSIT',self.cash,self.kvb,'3000','Cash',(7000,23000,5000)),
                ('WITHDRAWAL',self.sbi,self.cash,'2000','Cash',(9000,23000,3000)),
                ('TRANSFER',self.kvb,self.sbi,'5000','NEFT',(9000,18000,8000)),
                ('TRANSFER',self.sbi,self.kvb,'1000','Cheque',(9000,19000,7000))]:
            response=self.post(kind,source,target,amount,mode)
            self.assertEqual(response.status_code,201,response.data)
            self.assertEqual(self.balances(),tuple(Decimal(value) for value in expected),(kind,source.name,target.name))
            self.assertEqual(sum(self.balances()),total)
        statement=self.client.get('/api/finance/reports/ledger/',{'type':'bank'}).data
        kvb_rows=[row for row in statement['rows'] if 'KVB -> SBI' in row['particulars']]
        self.assertEqual(len(kvb_rows),1)
        # Both legs sit in the Bank Ledger: SBI debited (+), KVB credited (−), same amount.
        self.assertEqual((Decimal(str(kvb_rows[0]['debit'])),Decimal(str(kvb_rows[0]['credit']))),(Decimal('5000'),Decimal('5000')))
        self.assertEqual(self.trial_gap(),gap)
        vouchers=self.client.get(self.url).data['results']
        self.assertEqual(len({row['voucher_no'] for row in vouchers}),4)
        self.assertEqual({row['transaction_type_display'] for row in vouchers},{'Cash Deposit','Cash Withdrawal','Bank Transfer'})

    def test_invalid_selections_amounts_and_modes_are_rejected_without_saving(self):
        for kind,source,target,amount,mode in [
                ('TRANSFER',self.kvb,self.kvb,'10','NEFT'),     # same ledger
                ('TRANSFER',self.kvb,self.sbi,'0','NEFT'),      # zero
                ('TRANSFER',self.kvb,self.sbi,'-5','NEFT'),     # negative
                ('TRANSFER',self.cash,self.sbi,'10','NEFT'),    # cash is not a bank
                ('DEPOSIT',self.kvb,self.cash,'10','Cash'),     # wrong direction
                ('WITHDRAWAL',self.kvb,self.sbi,'10','Cash'),   # bank -> bank is not a withdrawal
                ('TRANSFER',self.kvb,self.sbi,'10','Cash'),     # cash mode on a bank transfer
                ('DEPOSIT',self.cash,self.kvb,'10','UPI'),      # incompatible mode
                ('DEPOSIT',self.cash,self.kvb,'10','')]:        # mode is mandatory
            self.assertEqual(self.post(kind,source,target,amount,mode).status_code,400,(kind,source.name,target.name,amount,mode))
        self.assertEqual(self.client.get(self.url).data['count'],0)
        self.assertEqual(self.balances(),(Decimal(10000),Decimal(20000),Decimal(5000)))

    def test_edit_replaces_and_delete_reverses_the_impact_once(self):
        saved=self.post('TRANSFER',self.kvb,self.sbi,'5000','NEFT').data
        detail=f"{self.url}{saved['id']}/"
        edited=self.client.patch(detail,dict(transaction_type='WITHDRAWAL',from_account=self.sbi.pk,to_account=self.cash.pk,amount='1500',payment_mode='Cheque'),format='json')
        self.assertEqual(edited.status_code,200,edited.data)
        self.assertEqual(edited.data['voucher_no'],saved['voucher_no'])
        self.assertEqual(self.balances(),(Decimal(11500),Decimal(20000),Decimal(3500)))
        self.assertEqual(self.client.get(self.url).data['count'],1)
        self.assertEqual(self.client.delete(detail).status_code,204)
        self.assertEqual(self.balances(),(Decimal(10000),Decimal(20000),Decimal(5000)))

    def test_transfer_saved_before_payment_mode_keeps_working(self):
        from .models import BankTransfer
        legacy=BankTransfer.objects.create(transaction_type='DEPOSIT',date='2026-01-01',from_account=self.cash,to_account=self.kvb,amount=100)
        detail=f"{self.url}{legacy.pk}/"
        self.assertEqual(self.client.get(detail).data['payment_mode'],'')
        self.assertEqual(self.client.patch(detail,{'notes':'kept'},format='json').status_code,200)
        self.assertEqual(self.client.patch(detail,{'transaction_type':'DEPOSIT'},format='json').status_code,400)
        self.assertEqual(self.balances(),(Decimal(9900),Decimal(20100),Decimal(5000)))

    def test_voucher_numbers_are_backend_generated_unique_and_never_reused(self):
        import re
        first=self.post('DEPOSIT',self.cash,self.kvb,'100','Cash').data
        second=self.post('DEPOSIT',self.cash,self.kvb,'100','Cash').data
        self.assertRegex(first['voucher_no'],r'^BT-\d{6,}$')
        number=lambda row:int(re.sub(r'\D','',row['voucher_no']))
        self.assertEqual(number(second),number(first)+1)
        # A voucher number sent by the client is ignored; the backend always assigns it.
        forged=self.client.post(self.url,dict(transaction_type='DEPOSIT',date='2026-10-12',from_account=self.cash.pk,to_account=self.kvb.pk,amount='5',payment_mode='Cash',voucher_no='BT-000001'),format='json').data
        self.assertEqual(number(forged),number(second)+1)
        # Edit / View keep the number; a deleted number is never handed out again.
        detail=f"{self.url}{second['id']}/"
        self.assertEqual(self.client.patch(detail,{'amount':'250','notes':'edited'},format='json').data['voucher_no'],second['voucher_no'])
        self.assertEqual(self.client.get(detail).data['voucher_no'],second['voucher_no'])
        self.assertEqual(self.client.delete(f"{self.url}{forged['id']}/").status_code,204)
        after=self.post('DEPOSIT',self.cash,self.kvb,'100','Cash').data
        self.assertGreater(number(after),number(forged))
        history={row['voucher_no'] for row in self.client.get(self.url).data['results']}
        self.assertEqual(history,{first['voucher_no'],second['voucher_no'],after['voucher_no']})

    def test_next_voucher_preview_continues_the_sequence(self):
        preview=self.client.get(f'{self.url}next-voucher/')
        self.assertEqual(preview.status_code,200,preview.data)
        saved=self.post('DEPOSIT',self.cash,self.kvb,'100','Cash').data
        self.assertEqual(saved['voucher_no'],preview.data['voucher_no'])
        upcoming=self.client.get(f'{self.url}next-voucher/').data['voucher_no']
        self.assertGreater(upcoming,saved['voucher_no'])
        # Deleting the latest voucher does not hand its number out again.
        self.assertEqual(self.client.delete(f"{self.url}{saved['id']}/").status_code,204)
        self.assertEqual(self.client.get(f'{self.url}next-voucher/').data['voucher_no'],upcoming)
        self.assertEqual(self.post('DEPOSIT',self.cash,self.kvb,'100','Cash').data['voucher_no'],upcoming)
        # Read access is enough to see the preview; anonymous users are refused.
        self.client.force_authenticate(User.objects.create_user('voucher-reader'))
        self.assertEqual(self.client.get(f'{self.url}next-voucher/').status_code,200)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(f'{self.url}next-voucher/').status_code,(401,403))
