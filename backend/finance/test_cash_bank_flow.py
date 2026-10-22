"""Collection / Payment Entry post their Cash/Bank side from the Payment Mode:
Cash -> the default Cash in Hand ledger, other modes -> the selected Bank Accounts ledger."""
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer

from .models import (ChitGroup, ChitGroupInstallmentDetail, CollectionTransaction, CustomerLoanDetails, Ledger,
                     LoanInstallment, LoanType, Mortgage, PaymentEntry)


class CashBankFlowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('cash-bank-admin', is_staff=True))
        customer = Customer.objects.create(customer_code='CB001', full_name='Flow Customer', primary_mobile='9876500091', role='BORROWER')
        loan_type = LoanType.objects.get_or_create(name='Chit')[0]
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        group = ChitGroup.objects.create(code='CBF', name='Flow Group', duration=2, duration_type='DAY')
        for number in (1, 2):
            ChitGroupInstallmentDetail.objects.create(group=group, installment_number=number, schedule_value=str(number), installment_amount=5000)
        response = self.client.post('/api/finance/loans/', {'customer_id': customer.pk, 'loan_type_id': loan_type.pk, 'amount': '10000',
            'start_date': timezone.localdate().isoformat(), 'chit_group_id': group.pk, 'include_sunday': True}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.loan = response.data
        self.url = f"/api/finance/customer-loan-installments/{self.loan['installments'][0]['id']}/collect/"
        self.cash = Ledger.objects.create(name='Cash', group='Cash-in-Hand')
        self.bank = Ledger.objects.create(name='KVB', group='Bank Accounts', bank_name='KVB', branch_name='Main', ifsc_code='KVBL0001234', account_number='123456789')
        self.expense = Ledger.objects.create(name='Office Expense', group='Indirect Expense')

    def collect(self, **extra):
        return self.client.post(self.url, {'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': '5000', **extra}, format='json')

    def pay(self, **extra):
        return self.client.post('/api/finance/payment-entries/', {'ledger': self.expense.pk, 'amount': '2000', 'date': timezone.localdate().isoformat(), **extra}, format='json')

    def balance(self, kind):
        response = self.client.get('/api/finance/reports/ledger/', {'type': kind})
        self.assertEqual(response.status_code, 200, response.data)
        sign = 1 if response.data['closing_balance_type'] == 'DR' else -1
        return sign * Decimal(str(response.data['closing_balance']))

    def test_cash_collection_debits_cash_in_hand_and_reduces_outstanding(self):
        response = self.collect(payment_mode='Cash')
        self.assertEqual(response.status_code, 200, response.data)
        row = CollectionTransaction.objects.get()
        self.assertEqual((row.account_id, row.collection_amount), (self.cash.pk, Decimal('5000.00')))
        self.assertEqual(CustomerLoanDetails.objects.get(pk=self.loan['id']).outstanding_amount, Decimal('5000.00'))
        self.assertEqual(self.balance('cash'), Decimal('5000.00'))
        self.assertEqual(self.balance('bank'), Decimal('0.00'))

    def test_bank_collection_requires_a_bank_ledger_and_debits_it(self):
        for extra in ({}, {'account_id': self.cash.pk}, {'account_id': self.expense.pk}, {'account_id': 'abc'}):
            self.assertEqual(self.collect(payment_mode='UPI', upi_id='a@b', transaction_utr='U1', **extra).status_code, 400, extra)
        self.assertFalse(CollectionTransaction.objects.exists())
        response = self.collect(payment_mode='UPI', upi_id='a@b', transaction_utr='U1', account_id=self.bank.pk)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(CollectionTransaction.objects.get().account_id, self.bank.pk)
        self.assertEqual((self.balance('bank'), self.balance('cash')), (Decimal('5000.00'), Decimal('0.00')))

    def test_payment_entry_credits_cash_or_bank_and_debits_the_ledger(self):
        cash = self.pay(payment_mode='Cash')
        self.assertEqual(cash.status_code, 201, cash.data)
        self.assertEqual(PaymentEntry.objects.get(pk=cash.data['id']).account_id, self.cash.pk)
        self.assertEqual(self.pay(payment_mode='NEFT', transaction_utr='N1', bank_name='KVB').status_code, 400)
        bank = self.pay(payment_mode='NEFT', transaction_utr='N1', bank_name='KVB', account=self.bank.pk)
        self.assertEqual(bank.status_code, 201, bank.data)
        self.assertEqual((self.balance('cash'), self.balance('bank')), (Decimal('-2000.00'), Decimal('-2000.00')))
        trial = self.client.get('/api/finance/reports/trial-balance/').data
        self.assertEqual(Decimal(str(trial['total_debit'])), Decimal(str(trial['total_credit'])))

    def test_edit_moves_the_posting_and_delete_reverses_it(self):
        collection_id = self.collect(payment_mode='Cash').data['collection_id']
        url = f'/api/finance/collection-transactions/{collection_id}/'
        self.assertEqual(self.client.patch(url, {'payment_mode': 'UPI', 'upi_id': 'a@b', 'reference_no': 'U2'}, format='json').status_code, 400)
        response = self.client.patch(url, {'payment_mode': 'UPI', 'upi_id': 'a@b', 'reference_no': 'U2', 'account': self.bank.pk}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual((self.balance('cash'), self.balance('bank')), (Decimal('0.00'), Decimal('5000.00')))
        self.assertEqual(CollectionTransaction.objects.count(), 1)
        self.assertEqual(self.client.patch(url, {'payment_mode': 'Cash', 'account': None}, format='json').status_code, 200)
        self.assertEqual((self.balance('cash'), self.balance('bank')), (Decimal('5000.00'), Decimal('0.00')))
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertEqual((self.balance('cash'), self.balance('bank')), (Decimal('0.00'), Decimal('0.00')))
        self.assertEqual(CustomerLoanDetails.objects.get(pk=self.loan['id']).outstanding_amount, Decimal('10000.00'))

    def test_several_cash_ledgers_need_an_explicit_default(self):
        other = Ledger.objects.create(name='Petty Cash', group='Cash-in-Hand')
        response = self.collect(payment_mode='Cash')
        self.assertEqual(response.status_code, 400)
        self.assertIn('CHITFUND_DEFAULT_CASH_LEDGER_ID', response.data['detail'])
        self.assertFalse(CollectionTransaction.objects.exists())
        with override_settings(CHITFUND_DEFAULT_CASH_LEDGER_ID=str(other.pk)):
            self.assertEqual(self.collect(payment_mode='Cash').status_code, 200)
        self.assertEqual(CollectionTransaction.objects.get().account_id, other.pk)

    def test_ledger_hsn_rot_round_trip_and_mortgage_without_tax_fields(self):
        created = self.client.post('/api/finance/ledgers/', {'name': 'GST Ledger', 'group': 'Income', 'hsn_code': ' 9971 ', 'rate_of_tax': 18}, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        url = f"/api/finance/ledgers/{created.data['id']}/"
        self.assertEqual((self.client.get(url).data['hsn_code'], self.client.get(url).data['rate_of_tax']), ('9971', 18))
        self.assertEqual(self.client.patch(url, {'rate_of_tax': 5}, format='json').data['rate_of_tax'], 5)
        self.assertEqual(self.client.patch(url, {'rate_of_tax': 7}, format='json').status_code, 400)
        product = self.client.post('/api/finance/mortgages/', {'product_group': 'Gold', 'product_name': 'Ring', 'unit': 'Gram', 'uqc': 'gms',
                                                               'current_rate': '6000', 'rate_date': timezone.localdate().isoformat()}, format='json')
        self.assertEqual(product.status_code, 201, product.data)
        self.assertEqual((Mortgage.objects.get(pk=product.data['id']).uqc), 'GMS')
        self.assertEqual(len(product.data['rate_history']), 1)

    def test_cash_mode_posts_to_the_chosen_cash_account_and_rejects_a_bank_account(self):
        self.assertEqual(self.collect(payment_mode='Cash', account_id=self.bank.pk).status_code, 400)
        self.assertEqual(self.pay(payment_mode='Cash', account=self.bank.pk).status_code, 400)
        response = self.collect(payment_mode='Cash', account_id=self.cash.pk)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(CollectionTransaction.objects.get().account_id, self.cash.pk)
        payment = self.pay(payment_mode='Cash', account=self.cash.pk)
        self.assertEqual(payment.status_code, 201, payment.data)
        self.assertEqual(PaymentEntry.objects.get(pk=payment.data['id']).account_id, self.cash.pk)

    def test_only_one_cash_in_hand_ledger_but_many_bank_ledgers(self):
        duplicate = self.client.post('/api/finance/ledgers/', {'name': 'Petty Cash', 'group': 'Cash-in-Hand'}, format='json')
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn('group', duplicate.data)
        self.assertEqual(self.client.patch(f'/api/finance/ledgers/{self.cash.pk}/', {'name': 'Main Cash'}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(f'/api/finance/ledgers/{self.expense.pk}/', {'group': 'Cash-in-Hand'}, format='json').status_code, 400)
        bank = self.client.post('/api/finance/ledgers/', {'name': 'SBI', 'group': 'Bank Accounts', 'bank_name': 'SBI', 'branch_name': 'Main',
                                                           'ifsc_code': 'SBIN0001234', 'account_number': '987654321'}, format='json')
        self.assertEqual(bank.status_code, 201, bank.data)
        self.assertEqual(Ledger.objects.filter(group='Bank Accounts').count(), 2)

    def test_tax_fields_are_kept_only_for_income_and_expense_ledgers(self):
        income = self.client.post('/api/finance/ledgers/', {'name': 'Fees', 'group': 'Income', 'hsn_code': '9971', 'rate_of_tax': 18}, format='json')
        self.assertEqual((income.data['hsn_code'], income.data['rate_of_tax']), ('9971', 18))
        debtor = self.client.post('/api/finance/ledgers/', {'name': 'Ravi', 'group': 'Sundry Debtors', 'hsn_code': '9971', 'rate_of_tax': 18}, format='json')
        self.assertEqual(debtor.status_code, 201, debtor.data)
        self.assertEqual((debtor.data['hsn_code'], debtor.data['rate_of_tax']), ('', 0))

    def test_collection_debits_cash_and_credits_the_selected_ledger(self):
        from .accounting_reports import ledger_balances
        party = Ledger.objects.get(customer__customer_code='CB001')
        response = self.collect(payment_mode='Cash', account_id=self.cash.pk, party_ledger_id=party.pk)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(CollectionTransaction.objects.get().party_ledger_id, party.pk)
        _, balances, suspense = ledger_balances()
        self.assertEqual((balances[self.cash.pk], balances[party.pk], suspense), (Decimal('5000.00'), Decimal('-5000.00'), Decimal('0.00')))

    def test_collection_without_a_ledger_credits_the_customer_ledger(self):
        response = self.collect(payment_mode='Cash')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(CollectionTransaction.objects.get().party_ledger, Ledger.objects.get(customer__customer_code='CB001'))

    def test_cash_and_bank_ledgers_are_rejected_on_the_ledger_side(self):
        self.assertEqual(self.collect(payment_mode='Cash', party_ledger_id=self.bank.pk).status_code, 400)
        self.assertEqual(self.pay(payment_mode='Cash', ledger=self.cash.pk).status_code, 400)
        self.assertFalse(CollectionTransaction.objects.exists())

    def test_payment_entry_debits_the_ledger_and_credits_the_bank(self):
        from .accounting_reports import ledger_balances
        for mode in ('NEFT', 'RTGS', 'IMPS'):
            response = self.pay(payment_mode=mode, transaction_utr='R1', bank_name='KVB', account=self.bank.pk)
            self.assertEqual(response.status_code, 201, response.data)
        _, balances, _ = ledger_balances()
        self.assertEqual((balances[self.expense.pk], balances[self.bank.pk]), (Decimal('6000.00'), Decimal('-6000.00')))

    def test_today_report_payment_mode_is_cash_or_bank_from_the_account(self):
        self.collect(payment_mode='Cash', customer_paid_amount='1000')
        self.collect(payment_mode='UPI', upi_id='a@b', transaction_utr='U1', account_id=self.bank.pk, customer_paid_amount='1000')
        self.pay(payment_mode='Cheque', cheque_number='1', cheque_date=timezone.localdate().isoformat(), bank_name='KVB', account=self.bank.pk)
        self.pay(payment_mode='Cash')
        rows = self.client.get('/api/finance/reports/today/').data['rows']
        by_type = sorted((row['transaction_type'], row['account_type']) for row in rows)
        self.assertEqual(by_type, [('Loan', ''), ('Payment', 'Bank'), ('Payment', 'Cash'), ('Receipt', 'Bank'), ('Receipt', 'Cash')])
