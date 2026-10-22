from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer
from .models import CollectionTransaction, CustomerLoanDetails, CustomerLoanInstallmentDetails, LoanType
from .views import _collection_row


class TodayCollectionReportDueDaysTests(TestCase):
    """Due Days = MAX(0, today - earliest unpaid installment due date), evaluated per
    installment row (each row already represents one specific unpaid schedule entry)."""

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('due-days-admin', is_staff=True))
        self.customer = Customer.objects.create(customer_code='DDR001', full_name='Due Days Customer',
                                                 primary_mobile='9876500099', role='BORROWER')
        self.loan_type = LoanType.objects.get_or_create(name='Chit')[0]
        self.today = timezone.localdate()

    def make_loan(self):
        return CustomerLoanDetails.objects.create(
            customer=self.customer, loan_type=self.loan_type, loan_amount=Decimal('1000.00'),
            loan_start_date=self.today, total_amount=Decimal('1000.00'),
        )

    def make_installment(self, loan, number, due_date, amount=Decimal('100.00')):
        return CustomerLoanInstallmentDetails.objects.create(
            loan=loan, installment_number=number, due_date=due_date, installment_amount=amount,
        )

    def test_due_today_is_zero(self):
        installment = self.make_installment(self.make_loan(), 1, self.today)
        row = _collection_row(installment, self.today)
        self.assertEqual(row['due_days'], 0)
        self.assertFalse(row['is_overdue'])

    def test_selected_report_date_recalculates_due_days(self):
        report_date = self.today - timedelta(days=3)
        self.make_installment(self.make_loan(), 1, report_date)
        response = self.client.get('/api/finance/collections/', {'date': report_date.isoformat()})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['due_days'], 0)

    def test_future_installment_is_zero(self):
        installment = self.make_installment(self.make_loan(), 1, self.today + timedelta(days=5))
        row = _collection_row(installment, self.today)
        self.assertEqual(row['due_days'], 0)
        self.assertFalse(row['is_overdue'])

    def test_overdue_by_three_days(self):
        installment = self.make_installment(self.make_loan(), 1, self.today - timedelta(days=3))
        row = _collection_row(installment, self.today)
        self.assertEqual(row['due_days'], 3)
        self.assertTrue(row['is_overdue'])

    def test_fully_paid_installment_is_not_overdue(self):
        loan = self.make_loan()
        installment = self.make_installment(loan, 1, self.today - timedelta(days=3))
        CollectionTransaction.objects.create(installment=installment, loan=loan, customer=self.customer,
                                              collection_amount=Decimal('100.00'), collection_date=self.today)
        row = _collection_row(installment, self.today)
        self.assertEqual(row['balance'], Decimal('0.00'))
        self.assertEqual(row['due_days'], 0)
        self.assertFalse(row['is_overdue'])

    def test_partial_payment_still_counts_due_days(self):
        loan = self.make_loan()
        installment = self.make_installment(loan, 1, self.today - timedelta(days=4))
        CollectionTransaction.objects.create(installment=installment, loan=loan, customer=self.customer,
                                              collection_amount=Decimal('40.00'), collection_date=self.today)
        row = _collection_row(installment, self.today)
        self.assertEqual(row['balance'], Decimal('60.00'))
        self.assertEqual(row['due_days'], 4)
        self.assertTrue(row['is_overdue'])

    def test_multiple_overdue_installments_each_keep_their_own_due_days(self):
        loan = self.make_loan()
        older = self.make_installment(loan, 1, self.today - timedelta(days=6))
        newer = self.make_installment(loan, 2, self.today - timedelta(days=2))
        self.assertEqual(_collection_row(older, self.today)['due_days'], 6)
        self.assertEqual(_collection_row(newer, self.today)['due_days'], 2)

    def test_today_collection_report_endpoint_includes_due_days_without_changing_totals(self):
        installment = self.make_installment(self.make_loan(), 1, self.today, amount=Decimal('250.00'))
        response = self.client.get('/api/finance/collections/', {'date': self.today.isoformat()})
        self.assertEqual(response.status_code, 200, response.data)
        rows = response.data['results']
        self.assertEqual(len(rows), 1)
        self.assertIn('due_days', rows[0])
        self.assertEqual(rows[0]['due_days'], 0)
        self.assertEqual(Decimal(str(rows[0]['due_amount'])), Decimal('250.00'))
        self.assertEqual(Decimal(str(rows[0]['balance'])), Decimal('250.00'))

    def test_date_filter_scopes_results_and_has_no_duplicates(self):
        loan = self.make_loan()
        self.make_installment(loan, 1, self.today)
        self.make_installment(loan, 2, self.today + timedelta(days=1))
        response = self.client.get('/api/finance/collections/', {'date': self.today.isoformat()})
        self.assertEqual(response.status_code, 200, response.data)
        ids = [row['installment_id'] for row in response.data['results']]
        self.assertEqual(len(ids), 1)
        self.assertEqual(len(ids), len(set(ids)))

    def test_summary_totals_unaffected_by_due_days_field(self):
        loan = self.make_loan()
        self.make_installment(loan, 1, self.today, amount=Decimal('250.00'))
        before = self.client.get('/api/finance/collections/summary/').data
        self.assertEqual(Decimal(str(before['today_due'])), Decimal('250.00'))
        self.assertEqual(Decimal(str(before['today_remaining'])), Decimal('250.00'))
