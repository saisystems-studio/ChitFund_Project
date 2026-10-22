from .test_support import ensure_cash_ledger
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.db.models import Sum
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import UserProfile
from customers.models import Customer
from .models import (ChitGroup, ChitGroupInstallmentDetail, CollectionTransaction, CustomerLoanDetails,
                     CustomerLoanInstallmentDetails, LoanInstallment, LoanType, PaymentEntry)

URL = '/api/finance/reports/today/'


class TodayReportTests(TestCase):
    """Today Report = register of saved Loan applications, Collection receipts and Payment
    Entries, each on its own transaction date, built from those source rows only."""

    def setUp(self):
        ensure_cash_ledger()
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('today-admin', is_staff=True))
        self.kumar = Customer.objects.create(customer_code='TR001', full_name='Kumar', primary_mobile='9876500011', role='BORROWER')
        self.ravi = Customer.objects.create(customer_code='TR002', full_name='Ravi', primary_mobile='9876500012', role='BORROWER')
        self.types = {name: LoanType.objects.get_or_create(name=name)[0] for name in ('Chit', 'Interest', 'Mortgage')}
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='TRG', name='Today Group', duration=3, duration_type='DAY')
        for number in (1, 2, 3):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=number,
                                                     schedule_value=str(number), installment_amount=50)
        self.today = timezone.localdate()

    def day(self, offset):
        return (self.today + timedelta(days=offset)).isoformat()

    def loan(self, kind, start, amount='100', customer=None):
        payload = {'customer_id': (customer or self.kumar).pk, 'loan_type_id': self.types[kind].pk, 'amount': amount,
                   'start_date': start, 'interest_percentage': '10', 'periodicity': 'Daily', 'interest_duration': 3,
                   'chit_group_id': self.group.pk, 'include_sunday': True}
        response = self.client.post('/api/finance/loans/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return CustomerLoanDetails.objects.get(pk=response.data['id'])

    def collect(self, loan, on, amount):
        installment = loan.installment_details.order_by('installment_number').first()
        response = self.client.post(f'/api/finance/customer-loan-installments/{installment.id}/collect/',
                                    {'payment_date': on, 'customer_paid_amount': amount, 'payment_mode': 'Cash'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        return CollectionTransaction.objects.get(pk=response.data['collection_id'])

    def payment(self, on, amount='75.50', ledger_name='Office Rent'):
        ledger = self.client.post('/api/finance/ledgers/', {'name': ledger_name, 'group': 'Indirect Expense'}, format='json')
        self.assertEqual(ledger.status_code, 201, getattr(ledger, 'data', None))
        response = self.client.post('/api/finance/payment-entries/', {'ledger': ledger.data['id'], 'accounts': 'Card', 'amount': amount,
                                                                     'payment_mode': 'Cash', 'date': on}, format='json')
        self.assertEqual(response.status_code, 201, getattr(response, 'data', None))
        return PaymentEntry.objects.get(pk=response.data['id'])

    def report(self, **params):
        response = self.client.get(URL, params)
        self.assertEqual(response.status_code, 200, getattr(response, 'data', None))
        return response.data

    def test_saved_chit_interest_and_mortgage_loans_appear_on_their_loan_date(self):
        loan_day = self.day(-3)
        loans = {kind: self.loan(kind, loan_day, amount) for kind, amount in (('Chit', '100'), ('Interest', '2000'), ('Mortgage', '5000'))}
        rows = [row for row in self.report(**{'from': loan_day, 'to': loan_day})['rows'] if row['transaction_type'] == 'Loan']
        self.assertEqual(len(rows), 3)
        for row in rows:
            loan = loans[row['loan_type']]
            self.assertEqual(row['key'], f'LOAN-{loan.id}')
            self.assertEqual(str(row['date']), loan_day)
            self.assertEqual(row['loan_no'], loan.doc_no)
            self.assertEqual(row['customer'], 'Kumar')
            self.assertIn('Kumar', row['particulars'])
            self.assertEqual(Decimal(str(row['amount'])), loan.loan_amount)
        self.assertEqual({Decimal(str(row['amount'])) for row in rows}, {Decimal('100'), Decimal('2000'), Decimal('5000')})
        self.assertFalse([row for row in self.report()['rows'] if row['transaction_type'] == 'Loan'], 'not on today')

    def test_collection_entry_appears_once_as_receipt_on_collection_date(self):
        loan = self.loan('Chit', self.day(-4))
        receipt = self.collect(loan, self.day(-1), '120')  # spans several installments, still one receipt
        rows = self.report(**{'from': self.day(-1), 'to': self.day(-1)})['rows']
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row['transaction_type'], row['key'], row['voucher_no']), ('Receipt', f'RECEIPT-{receipt.id}', f'RV-{receipt.id:06d}'))
        self.assertEqual((row['loan_type'], row['loan_no'], row['customer']), ('Chit', loan.doc_no, 'Kumar'))
        self.assertEqual(Decimal(str(row['amount'])), Decimal('120.00'))

    def test_payment_entry_without_loan_appears_with_blank_loan_fields(self):
        entry = self.payment(self.day(-2))
        rows = self.report(**{'from': self.day(-2), 'to': self.day(-2)})['rows']
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row['transaction_type'], row['key'], row['voucher_no']), ('Payment', f'PAYMENT-{entry.id}', f'PV-{entry.id:06d}'))
        self.assertEqual((row['loan_type'], row['loan_no'], row['loan_id']), ('', '', None))
        self.assertIn('Office Rent', row['particulars'])
        self.assertEqual(Decimal(str(row['amount'])), Decimal('75.50'))

    def test_scheduled_dues_never_create_receipts(self):
        loan = self.loan('Chit', self.day(-5))
        due_in_range = CustomerLoanInstallmentDetails.objects.filter(loan=loan, due_date__range=(self.day(-5), self.day(0))).count()
        self.assertGreater(due_in_range, 0, 'fixture must have installments due inside the range')
        rows = self.report(**{'from': self.day(-5), 'to': self.day(0)})['rows']
        self.assertEqual([row['transaction_type'] for row in rows], ['Loan'])

    def test_example_loan_date_and_later_collection_date_are_separate_days(self):
        loan = self.loan('Interest', self.day(-7), '50000')
        receipt = self.collect(loan, self.day(-3), '500')
        loan_day = self.report(**{'from': self.day(-7), 'to': self.day(-7)})['rows']
        collection_day = self.report(**{'from': self.day(-3), 'to': self.day(-3)})['rows']
        self.assertEqual([(row['transaction_type'], Decimal(str(row['amount']))) for row in loan_day], [('Loan', Decimal('50000.00'))])
        self.assertEqual([(row['key'], Decimal(str(row['amount']))) for row in collection_day], [(f'RECEIPT-{receipt.id}', Decimal('500.00'))])

    def test_default_is_today_and_ranges_are_inclusive(self):
        today_loan = self.loan('Chit', self.day(0))
        self.loan('Chit', self.day(-1))
        self.loan('Chit', self.day(-10))
        self.assertEqual([row['key'] for row in self.report()['rows']], [f'LOAN-{today_loan.id}'])
        self.assertEqual(len(self.report(**{'from': self.day(-1), 'to': self.day(0)})['rows']), 2)
        self.assertEqual(len(self.report(**{'from': self.day(-10), 'to': self.day(-1)})['rows']), 2)
        self.assertEqual(len(self.report(**{'from': self.day(-9), 'to': self.day(-2)})['rows']), 0)

    def test_loan_type_and_loan_number_filters_apply_to_all_transaction_types(self):
        chit = self.loan('Chit', self.day(-2))
        interest = self.loan('Interest', self.day(-2), '1000', customer=self.ravi)
        chit_receipt = self.collect(chit, self.day(-1), '50')
        self.collect(interest, self.day(-1), '40')
        self.payment(self.day(-1))
        window = {'from': self.day(-2), 'to': self.day(-1)}
        self.assertEqual(sorted(row['transaction_type'] for row in self.report(**window)['rows']), ['Loan', 'Loan', 'Payment', 'Receipt', 'Receipt'])
        chit_rows = self.report(**window, loan_type='Chit')['rows']
        self.assertEqual([row['key'] for row in chit_rows], [f'LOAN-{chit.id}', f'RECEIPT-{chit_receipt.id}'])
        self.assertEqual(len(self.report(**window, loan_type='ALL')['rows']), 5)
        loan_rows = self.report(**window, loan_id=interest.id)['rows']
        self.assertEqual({row['loan_id'] for row in loan_rows}, {interest.id})
        self.assertEqual([row['transaction_type'] for row in loan_rows], ['Loan', 'Receipt'])
        self.assertEqual(self.report(**window, loan_type='Mortgage')['rows'], [])

    def test_rows_sorted_by_date_then_type_with_unique_keys_and_source_totals(self):
        chit = self.loan('Chit', self.day(-2))
        self.collect(chit, self.day(-2), '30')
        self.payment(self.day(-2), '10')
        self.collect(chit, self.day(-1), '25')
        self.loan('Mortgage', self.day(-1), '700')
        self.payment(self.day(-1), '20', 'Electricity')
        data = self.report(**{'from': self.day(-2), 'to': self.day(-1)})
        rows = data['rows']
        self.assertEqual([(str(row['date']), row['transaction_type']) for row in rows], [
            (self.day(-2), 'Loan'), (self.day(-2), 'Receipt'), (self.day(-2), 'Payment'),
            (self.day(-1), 'Loan'), (self.day(-1), 'Receipt'), (self.day(-1), 'Payment')])
        self.assertEqual(len({row['key'] for row in rows}), len(rows))
        totals = data['totals']
        window = (self.day(-2), self.day(-1))
        self.assertEqual(Decimal(str(totals['Receipt']['amount'])), CollectionTransaction.objects.filter(collection_date__range=window).aggregate(s=Sum('collection_amount'))['s'])
        self.assertEqual(Decimal(str(totals['Payment']['amount'])), PaymentEntry.objects.filter(date__range=window).aggregate(s=Sum('amount'))['s'])
        self.assertEqual(Decimal(str(totals['Loan']['amount'])), CustomerLoanDetails.objects.filter(loan_start_date__range=window).aggregate(s=Sum('loan_amount'))['s'])
        self.assertEqual((totals['Loan']['count'], totals['Receipt']['count'], totals['Payment']['count'], data['count']), (2, 2, 2, 6))

    def test_rejects_bad_dates_and_loan_ids(self):
        for params in ({'from': 'bad'}, {'from': self.day(0), 'to': self.day(-1)}, {'loan_id': 'x'}):
            self.assertEqual(self.client.get(URL, params).status_code, 400, params)

    def test_report_requires_login_is_readable_by_view_only_users_and_read_only(self):
        self.payment(self.day(0))
        viewer = User.objects.create_user('today-viewer')
        UserProfile.objects.create(user=viewer, can_write=False)
        self.client.force_authenticate(viewer)
        self.assertEqual(self.client.get(URL).status_code, 200)
        self.assertEqual(self.client.post(URL, {}).status_code, 405)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(URL).status_code, (401, 403))
