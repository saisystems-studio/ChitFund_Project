from .test_support import ensure_cash_ledger
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import UserProfile
from customers.models import Customer
from .models import (ChitGroup, ChitGroupInstallmentDetail, CollectionTransaction, CustomerLoanDetails,
                     CustomerLoanInstallmentDetails, LoanInstallment, LoanKycDocument, LoanType)

URL = '/api/finance/reports/today-collection/'


class TodayCollectionFixtures(TestCase):
    """Shared fixtures/helpers (no tests of its own)."""

    def setUp(self):
        ensure_cash_ledger()
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('pending-admin', is_staff=True))
        self.kumar = Customer.objects.create(customer_code='PD001', full_name='Kumar', primary_mobile='9876500301', role='BORROWER')
        self.ravi = Customer.objects.create(customer_code='PD002', full_name='Ravi', primary_mobile='9876500302', role='BORROWER')
        self.types = {name: LoanType.objects.get_or_create(name=name)[0] for name in ('Chit', 'Interest', 'Mortgage')}
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='PDG', name='Pending Group', duration=3, duration_type='DAY')
        for number in (1, 2, 3):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=number, schedule_value=str(number), installment_amount=50)
        self.today = timezone.localdate()

    def day(self, offset):
        return self.today + timedelta(days=offset)

    def loan(self, kind, start_offset, amount='1000', customer=None):
        response = self.client.post('/api/finance/loans/', {
            'customer_id': (customer or self.kumar).pk, 'loan_type_id': self.types[kind].pk, 'amount': amount,
            'start_date': self.day(start_offset).isoformat(), 'interest_percentage': '10', 'periodicity': 'Daily',
            'interest_duration': 3, 'chit_group_id': self.group.pk, 'include_sunday': True}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return CustomerLoanDetails.objects.get(pk=response.data['id'])

    def installments(self, loan):
        return list(loan.installment_details.order_by('installment_number'))

    def collect(self, loan, offset, amount, **extra):
        first = self.installments(loan)[0]
        response = self.client.post(f'/api/finance/customer-loan-installments/{first.id}/collect/',
                                    {'payment_date': self.day(offset).isoformat(), 'customer_paid_amount': amount, 'payment_mode': 'Cash', **extra}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        return CollectionTransaction.objects.get(pk=response.data['collection_id'])

    def report(self, **params):
        response = self.client.get(URL, {k: (v.isoformat() if hasattr(v, 'isoformat') else v) for k, v in params.items()})
        self.assertEqual(response.status_code, 200, getattr(response, 'data', None))
        return response.data

    def by_installment(self, data):
        return {row['installment_id']: row for row in data['rows']}



class TodayCollectionReportTests(TodayCollectionFixtures):
    """Pending dues as of the report date, per schedule installment, from saved collections
    (allocations) only: overdue + due-today + partially paid (and Completed when settled in
    the period); never future-unpaid or Payment Entry rows; Due Days = as-of date − due date."""

    def test_overdue_and_due_today_appear_future_does_not(self):
        loan = self.loan('Chit', -1)  # chit dues on day -1, 0 and +1
        first, second, third = self.installments(loan)
        self.assertEqual((first.due_date, second.due_date, third.due_date), (self.day(-1), self.day(0), self.day(1)))
        data = self.report()
        self.assertEqual(data['as_of'], self.today)
        rows = self.by_installment(data)
        self.assertEqual(set(rows), {first.id, second.id})
        self.assertEqual((rows[first.id]['due_days'], rows[first.id]['transaction_type']), (1, 'Overdue'))
        self.assertEqual((rows[second.id]['due_days'], rows[second.id]['transaction_type']), (0, 'Due Today'))
        self.assertEqual({Decimal(str(row['amount'])) for row in rows.values()}, {Decimal('50.00')})
        self.assertEqual(rows[first.id]['loan_no'], loan.doc_no)

    def test_due_days_is_calendar_days_from_the_unpaid_due_date_not_the_loan_start(self):
        loan = self.loan('Chit', -7)
        rows = self.by_installment(self.report())
        for installment in self.installments(loan):
            self.assertEqual(rows[installment.id]['due_days'], (self.today - installment.due_date).days)
            self.assertEqual(rows[installment.id]['date'], installment.due_date)
        self.assertEqual(max(row['due_days'] for row in rows.values()), 7)

    def test_one_receipt_across_installments_uses_allocations(self):
        loan = self.loan('Chit', -1)
        first, second, _ = self.installments(loan)
        receipt = self.collect(loan, 0, '70')  # one receipt: 50 → inst 1, 20 → inst 2
        self.assertEqual(receipt.installment_id, first.id)
        rows = self.by_installment(self.report())
        self.assertEqual((rows[first.id]['status'], Decimal(str(rows[first.id]['balance_amount']))), ('Completed', Decimal('0.00')),
                         'installment settled in the period shows as Completed')
        self.assertEqual((Decimal(str(rows[second.id]['due_amount'])), Decimal(str(rows[second.id]['paid_amount'])), Decimal(str(rows[second.id]['amount']))),
                         (Decimal('50.00'), Decimal('20.00'), Decimal('30.00')))
        self.assertEqual(rows[second.id]['status'], 'Partial')

    def test_fully_paid_loan_shows_completed_only_in_the_collection_period(self):
        loan = self.loan('Chit', -2)  # dues on -2, -1, 0
        self.collect(loan, -1, '150')
        yesterday = self.report(**{'from': self.day(-1), 'to': self.day(-1)})
        self.assertEqual({row['status'] for row in yesterday['rows']}, {'Completed'})
        self.assertEqual(len(yesterday['rows']), 3, 'all three settled by that collection, the last one in advance')
        self.assertEqual([row['transaction_type'] for row in yesterday['rows']], ['Overdue', 'Due Today', 'Advance'])
        self.assertEqual(self.report()['rows'], [], 'settled before today and nothing collected today: not listed')

    def test_as_of_past_date_ignores_later_collections_and_later_penalty(self):
        loan = self.loan('Chit', -2)
        first, second, _ = self.installments(loan)
        self.collect(loan, 0, '30', penalty='10')  # today: 30 paid on inst 1, +10 penalty on inst 1
        today_rows = self.by_installment(self.report())
        self.assertEqual((Decimal(str(today_rows[first.id]['due_amount'])), Decimal(str(today_rows[first.id]['amount']))), (Decimal('60.00'), Decimal('30.00')))
        past = self.report(**{'from': self.day(-1), 'to': self.day(-1)})
        self.assertEqual(past['as_of'], self.day(-1))
        rows = self.by_installment(past)
        self.assertEqual(set(rows), {first.id, second.id})
        self.assertEqual((Decimal(str(rows[first.id]['due_amount'])), Decimal(str(rows[first.id]['amount'])), rows[first.id]['due_days']),
                         (Decimal('50.00'), Decimal('50.00'), 1))

    def test_range_uses_period_end_capped_at_today_and_keeps_earlier_overdue_once(self):
        loan = self.loan('Chit', -9)  # dues on -9, -8, -7
        week = self.report(**{'from': self.day(-6), 'to': self.day(-2)})
        self.assertEqual(week['as_of'], self.day(-2))
        self.assertEqual(sorted(row['installment_number'] for row in week['rows']), [1, 2, 3], 'dues before the range start are still listed')
        self.assertEqual(len({row['key'] for row in week['rows']}), len(week['rows']))
        future = self.report(**{'from': self.day(-3), 'to': self.day(20)})
        self.assertEqual(future['as_of'], self.today)
        self.assertEqual(len(future['rows']), 3)

    def test_all_time_includes_historic_collections(self):
        loan = self.loan('Chit', -9)
        first, second, third = self.installments(loan)
        self.collect(loan, -8, '50.00')
        response = self.client.get(URL, {'all_time': 'true', 'loan_type': 'Chit'})
        self.assertEqual(response.status_code, 200, getattr(response, 'data', None))
        rows = self.by_installment(response.data)
        self.assertEqual(response.data['as_of'], self.today)
        self.assertEqual(set(rows), {first.id, second.id, third.id})
        self.assertEqual(rows[first.id]['status'], 'Completed')

    def test_interest_and_mortgage_schedules_use_their_own_amounts(self):
        loans = [self.loan('Interest', -5, '2000'), self.loan('Mortgage', -5, '5000', customer=self.ravi)]
        rows = self.by_installment(self.report())
        for loan in loans:
            due = [row for row in self.installments(loan) if row.due_date <= self.today]
            self.assertTrue(due, f'{loan.loan_type.name} fixture must have a due installment')
            for installment in due:
                row = rows[installment.id]
                self.assertEqual(row['loan_type'], loan.loan_type.name)
                self.assertEqual(Decimal(str(row['amount'])), installment.installment_amount + installment.penalty_amount)
                self.assertEqual(row['due_days'], (self.today - installment.due_date).days)
            self.assertFalse(any(rows.get(i.id) for i in self.installments(loan) if i.due_date > self.today))

    def test_legacy_and_untraced_payments_are_honoured(self):
        loan = self.loan('Chit', -2)
        first, second, third = self.installments(loan)
        # Older receipt with no allocation rows, counted against its own installment.
        CollectionTransaction.objects.create(installment=first, loan=loan, customer=self.kumar, collection_amount=Decimal('50.00'), collection_date=self.day(-1))
        CustomerLoanInstallmentDetails.objects.filter(pk=first.pk).update(paid_amount=Decimal('50.00'), paid_date=self.day(-1))
        # Paid amount stored with no receipt at all: treated as paid.
        CustomerLoanInstallmentDetails.objects.filter(pk=second.pk).update(paid_amount=Decimal('50.00'))
        self.assertEqual(set(self.by_installment(self.report())), {third.id})
        self.assertIn(first.id, self.by_installment(self.report(**{'from': self.day(-2), 'to': self.day(-2)})), 'legacy receipt dated after the as-of date')

    def test_loan_type_and_loan_number_filters(self):
        chit = self.loan('Chit', -1)
        interest = self.loan('Interest', -3, '2000', customer=self.ravi)
        self.assertEqual({row['loan_type'] for row in self.report(loan_type='Chit')['rows']}, {'Chit'})
        self.assertEqual({row['loan_type'] for row in self.report(loan_type='Interest')['rows']}, {'Interest'})
        self.assertEqual({row['loan_id'] for row in self.report(loan_id=chit.id)['rows']}, {chit.id})
        self.assertEqual(self.report(loan_type='Mortgage')['rows'], [])
        self.assertEqual(len(self.report(loan_type='ALL')['rows']), len(self.report()['rows']))
        self.assertTrue(interest)

    def test_no_payment_entries_receipts_or_loan_rows(self):
        loan = self.loan('Chit', -1)
        self.collect(loan, 0, '20')
        ledger = self.client.post('/api/finance/ledgers/', {'name': 'Rent', 'group': 'Indirect Expense'}, format='json')
        self.client.post('/api/finance/payment-entries/', {'ledger': ledger.data['id'], 'accounts': 'Card', 'amount': '10', 'payment_mode': 'Cash',
                                                           'date': self.today.isoformat()}, format='json')
        rows = self.report()['rows']
        self.assertEqual({row['transaction_type'] for row in rows} - {'Overdue', 'Due Today', 'Advance'}, set())
        self.assertTrue(all(row['key'].startswith('INSTALLMENT-') for row in rows))
        self.assertEqual(len(rows), len({row['installment_id'] for row in rows}))

    def test_report_is_read_only_and_never_changes_schedules(self):
        loan = self.loan('Chit', -1)
        self.collect(loan, 0, '20')
        before = list(CustomerLoanInstallmentDetails.objects.filter(loan=loan).order_by('pk').values())
        self.report(); self.report(**{'from': self.day(-1), 'to': self.day(-1)})
        self.assertEqual(list(CustomerLoanInstallmentDetails.objects.filter(loan=loan).order_by('pk').values()), before)
        self.assertEqual(self.client.post(URL, {}).status_code, 405)

    def test_documents_follow_kyc_permissions(self):
        import io, tempfile
        from PIL import Image
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings
        loan = self.loan('Chit', -1)
        with tempfile.TemporaryDirectory() as private, override_settings(KYC_PRIVATE_ROOT=private):
            data = io.BytesIO(); Image.new('RGB', (4, 4)).save(data, 'JPEG')
            response = self.client.post(f'/api/finance/loans/{loan.id}/kyc-documents/', {'document_type': 'PAN', 'file': SimpleUploadedFile('p.jpg', data.getvalue(), content_type='image/jpeg')}, format='multipart')
            self.assertEqual(response.status_code, 201, response.data)
            admin_view = self.report()
            self.assertTrue(admin_view['documents_allowed'])
            self.assertEqual({(row['document_kind'], row['transaction_id'], row['document_count']) for row in admin_view['rows']}, {('loan', loan.id, 1)})
            viewer = User.objects.create_user('pending-viewer'); UserProfile.objects.create(user=viewer, can_write=False)
            self.client.force_authenticate(viewer)
            viewer_view = self.report()
            self.assertFalse(viewer_view['documents_allowed'])
            self.assertEqual({row['document_count'] for row in viewer_view['rows']}, {None})
            self.assertEqual(self.client.get(f'/api/finance/loans/{loan.id}/kyc-documents/').status_code, 403)
            self.client.force_authenticate(None)
            self.assertIn(self.client.get(URL).status_code, (401, 403))
            self.assertEqual(LoanKycDocument.objects.count(), 1)

    def test_rejects_bad_params(self):
        for params in ({'from': 'x'}, {'from': self.day(0).isoformat(), 'to': self.day(-1).isoformat()}, {'loan_id': 'abc'}):
            self.assertEqual(self.client.get(URL, params).status_code, 400, params)


class TodayCollectionStatusTests(TodayCollectionFixtures):
    """Received / Balance / Status per installment, collection history, and Edit / Delete of
    a collection through the existing collection editor (admin only)."""

    def row(self, installment, **params):
        return self.by_installment(self.report(**params)).get(installment.id)

    def amounts(self, row):
        return (Decimal(str(row['due_amount'])), Decimal(str(row['received_amount'])), Decimal(str(row['balance_amount'])), row['status'])

    def test_unpaid_due_is_pending_not_partial_or_completed(self):
        loan = self.loan('Interest', -1, '2000')
        first = self.installments(loan)[0]
        row = self.row(first)
        self.assertEqual(row['status'], 'Pending')
        self.assertEqual(Decimal(str(row['received_amount'])), Decimal('0.00'))
        self.assertIsNone(row['collection']); self.assertEqual(row['collections'], [])

    def test_partial_then_multiple_partials_then_final_payment_completes(self):
        loan = self.loan('Chit', 0)  # first due today, 50
        first = self.installments(loan)[0]
        self.collect(loan, 0, '20')
        self.assertEqual(self.amounts(self.row(first)), (Decimal('50.00'), Decimal('20.00'), Decimal('30.00'), 'Partial'))
        self.collect(loan, 0, '10')
        row = self.row(first)
        self.assertEqual(self.amounts(row), (Decimal('50.00'), Decimal('30.00'), Decimal('20.00'), 'Partial'), 'cumulative, previous collection kept')
        self.assertEqual([Decimal(str(item['amount'])) for item in row['collections']], [Decimal('20.00'), Decimal('10.00')])
        self.collect(loan, 0, '20')
        row = self.row(first)
        self.assertEqual(self.amounts(row), (Decimal('50.00'), Decimal('50.00'), Decimal('0.00'), 'Completed'))
        self.assertEqual(len(row['collections']), 3)
        self.assertEqual(row['collection']['voucher_no'], f"RV-{row['collections'][-1]['collection_id']:06d}")

    def test_full_payment_is_completed_and_overpay_goes_to_next_installment_not_double_counted(self):
        loan = self.loan('Chit', -1)  # dues -1, 0, +1 (50 each)
        first, second, third = self.installments(loan)
        self.collect(loan, 0, '120')  # 50 → 1, 50 → 2, 20 → 3 (advance)
        rows = self.by_installment(self.report())
        self.assertEqual(self.amounts(rows[first.id]), (Decimal('50.00'), Decimal('50.00'), Decimal('0.00'), 'Completed'))
        self.assertEqual(self.amounts(rows[second.id]), (Decimal('50.00'), Decimal('50.00'), Decimal('0.00'), 'Completed'))
        self.assertEqual(self.amounts(rows[third.id]), (Decimal('50.00'), Decimal('20.00'), Decimal('30.00'), 'Partial'))
        self.assertEqual(rows[third.id]['transaction_type'], 'Advance')
        total = sum(Decimal(str(row['received_amount'])) for row in rows.values())
        self.assertEqual(total, Decimal('120.00'), 'one receipt split across installments is counted once')

    def test_detail_fields_come_from_saved_records(self):
        loan = self.loan('Chit', 0)
        first = self.installments(loan)[0]
        receipt = self.collect(loan, 0, '20', notes='paid at shop')
        row = self.row(first)
        self.assertEqual((row['customer_code'], row['customer_phone'], row['plan_name'], row['loan_start_date']),
                         ('PD001', '9876500301', 'Pending Group', loan.loan_start_date))
        latest = row['collection']
        self.assertEqual((latest['collection_id'], latest['payment_mode'], latest['account'], latest['notes']),
                         (receipt.id, 'Cash', 'Cash in Hand', receipt.remarks))

    def test_edit_collection_recalculates_received_balance_and_status(self):
        loan = self.loan('Chit', 0)
        first = self.installments(loan)[0]
        receipt = self.collect(loan, 0, '50')
        self.assertEqual(self.row(first)['status'], 'Completed')
        response = self.client.patch(f'/api/finance/collection-transactions/{receipt.id}/', {'collection_amount': '35'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.amounts(self.row(first)), (Decimal('50.00'), Decimal('35.00'), Decimal('15.00'), 'Partial'))

    def test_delete_collection_recalculates_and_keeps_customer_and_loan(self):
        loan = self.loan('Chit', 0)
        first = self.installments(loan)[0]
        keep = self.collect(loan, 0, '20')
        drop = self.collect(loan, 0, '30')
        self.assertEqual(self.row(first)['status'], 'Completed')
        self.assertEqual(self.client.delete(f'/api/finance/collection-transactions/{drop.id}/').status_code, 204)
        row = self.row(first)
        self.assertEqual(self.amounts(row), (Decimal('50.00'), Decimal('20.00'), Decimal('30.00'), 'Partial'))
        self.assertEqual([item['collection_id'] for item in row['collections']], [keep.id], 'deleted receipt is not counted')
        self.assertTrue(CustomerLoanDetails.objects.filter(pk=loan.pk).exists())
        self.assertTrue(Customer.objects.filter(pk=self.kumar.pk).exists())
        self.client.delete(f'/api/finance/collection-transactions/{keep.id}/')
        self.assertEqual(self.row(first)['status'], 'Pending')

    def test_non_admin_cannot_edit_or_delete_collections(self):
        loan = self.loan('Chit', 0)
        receipt = self.collect(loan, 0, '20')
        writer = User.objects.create_user('pending-writer'); UserProfile.objects.create(user=writer, can_write=True)
        viewer = User.objects.create_user('pending-reader'); UserProfile.objects.create(user=viewer, can_write=False)
        for user in (writer, viewer):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.patch(f'/api/finance/collection-transactions/{receipt.id}/', {'collection_amount': '10'}, format='json').status_code, 403)
            self.assertEqual(self.client.delete(f'/api/finance/collection-transactions/{receipt.id}/').status_code, 403)
            self.assertEqual(self.client.get(URL).status_code, 200, 'viewing the report is still allowed')
        self.assertEqual(CollectionTransaction.objects.get(pk=receipt.pk).collection_amount, Decimal('20.00'))
