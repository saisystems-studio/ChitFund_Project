from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer
from .models import ChitGroup, ChitGroupInstallmentDetail, Ledger, LoanInstallment, LoanType


class CustomerWiseReportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('report-admin', is_staff=True))
        self.kumar = Customer.objects.create(customer_code='CWR001', full_name='Kumar',
                                             primary_mobile='9876500001', role='BORROWER')
        self.ravi = Customer.objects.create(customer_code='CWR002', full_name='Ravi',
                                            primary_mobile='9876500002', role='BORROWER')
        self.types = {name: LoanType.objects.get_or_create(name=name)[0] for name in ('Chit', 'Interest', 'Mortgage')}
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='CWR', name='Report Group', duration=2, duration_type='DAY')
        for number in (1, 2):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=number,
                                                     schedule_value=str(number), installment_amount=50)

    def loan(self, customer, kind):
        payload = {'customer_id': customer.pk, 'loan_type_id': self.types[kind].pk, 'amount': '100',
                   'start_date': timezone.localdate().isoformat(), 'interest_percentage': '10',
                   'periodicity': 'Daily', 'interest_duration': 2, 'chit_group_id': self.group.pk,
                   'include_sunday': True}
        response = self.client.post('/api/finance/loans/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def report(self, **params):
        response = self.client.get('/api/finance/reports/customer-wise/', params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_opening_balance_is_first_row_and_signed_by_dr_cr(self):
        Ledger.objects.filter(customer=self.kumar).update(opening_balance=Decimal('500.00'))
        data = self.report(customer=self.kumar.pk)
        rows = data['results'][0]['rows']
        self.assertEqual(rows[0]['particulars'], 'Opening Balance')
        self.assertEqual(Decimal(str(rows[0]['debit'])), Decimal('500.00'))
        self.assertEqual(Decimal(str(rows[0]['credit'])), Decimal('0.00'))
        self.assertEqual(Decimal(str(rows[0]['total'])), Decimal('500.00'))

        Ledger.objects.filter(customer=self.ravi).update(opening_balance=Decimal('-300.00'))
        data = self.report(customer=self.ravi.pk)
        rows = data['results'][0]['rows']
        self.assertEqual(rows[0]['particulars'], 'Opening Balance')
        self.assertEqual(Decimal(str(rows[0]['debit'])), Decimal('0.00'))
        self.assertEqual(Decimal(str(rows[0]['credit'])), Decimal('300.00'))
        self.assertEqual(Decimal(str(rows[0]['total'])), Decimal('300.00'))

    def test_chit_installments_post_as_debit_with_doc_no_and_group_name(self):
        loan_data = self.loan(self.kumar, 'Chit')
        data = self.report(customer=self.kumar.pk, loan_type='Chit')
        rows = data['results'][0]['rows']
        installment_rows = [row for row in rows if row['particulars'] != 'Opening Balance']
        self.assertEqual(len(installment_rows), 1)
        for row in installment_rows:
            self.assertIn('Report Group', row['particulars'])
            self.assertEqual(row['voucher_no'], loan_data['doc_no'])
            self.assertEqual(Decimal(str(row['debit'])), Decimal('50.00'))
            self.assertEqual(Decimal(str(row['credit'])), Decimal('0.00'))
            self.assertEqual(Decimal(str(row['total'])), Decimal('50.00'))

    def test_future_installments_stay_hidden_until_due(self):
        """Chit groups persist the whole future schedule the moment a loan is created, but
        the ledger must only post a Debit once an installment has actually accrued (due_date
        <= today) — otherwise it reads as a full schedule dump instead of a day-book. An
        explicit `to` date lets a caller deliberately look ahead of today."""
        self.loan(self.kumar, 'Chit')  # 2-day chit: installment #1 due today, #2 due tomorrow
        today_only = [row for row in self.report(customer=self.kumar.pk)['results'][0]['rows']
                      if row['particulars'] != 'Opening Balance']
        self.assertEqual(len(today_only), 1)
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
        looked_ahead = [row for row in self.report(customer=self.kumar.pk, to=tomorrow)['results'][0]['rows']
                        if row['particulars'] != 'Opening Balance']
        self.assertEqual(len(looked_ahead), 2)

    def test_collection_posts_as_separate_credit_without_touching_debit_rows(self):
        self.loan(self.kumar, 'Chit')
        installment = self.kumar.customer_loans.get(loan_type__name='Chit').installment_details.order_by('installment_number').first()
        from .models import CollectionTransaction
        txn = CollectionTransaction.objects.create(
            installment=installment, loan=installment.loan, customer=self.kumar,
            collection_amount=Decimal('50.00'), collection_date=timezone.localdate(),
        )
        data = self.report(customer=self.kumar.pk)
        rows = data['results'][0]['rows']
        receipt_rows = [row for row in rows if row['particulars'] == 'Receipt']
        self.assertEqual(len(receipt_rows), 1)
        self.assertEqual(receipt_rows[0]['voucher_no'], f'RV-{txn.id:06d}')
        self.assertEqual(Decimal(str(receipt_rows[0]['credit'])), Decimal('50.00'))
        debit_rows = [row for row in rows if row['particulars'] != 'Opening Balance' and row['particulars'] != 'Receipt']
        self.assertTrue(all(Decimal(str(row['debit'])) == Decimal('50.00') for row in debit_rows))

    def test_real_collect_endpoint_shows_as_credit_row(self):
        """Exercises the actual production save path used by the Collection Entry
        screen (POST /customer-loan-installments/<id>/collect/), not a hand-built
        CollectionTransaction, to prove the report reflects real saved receipts."""
        loan_data = self.loan(self.kumar, 'Chit')
        first_installment = self.kumar.customer_loans.get(pk=loan_data['id']).installment_details.order_by('installment_number').first()
        response = self.client.post(f'/api/finance/customer-loan-installments/{first_installment.id}/collect/', {
            'customer_paid_amount': '50', 'payment_date': timezone.localdate().isoformat(),
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        data = self.report(customer=self.kumar.pk)
        rows = data['results'][0]['rows']
        receipt_rows = [row for row in rows if row['particulars'] == 'Receipt']
        self.assertEqual(len(receipt_rows), 1, rows)
        self.assertEqual(Decimal(str(receipt_rows[0]['credit'])), Decimal('50.00'))
        self.assertEqual(Decimal(str(receipt_rows[0]['debit'])), Decimal('0.00'))

    def test_overall_total_sums_debit_and_credit_across_rows(self):
        self.loan(self.kumar, 'Chit')
        Ledger.objects.filter(customer=self.kumar).update(opening_balance=Decimal('100.00'))
        data = self.report(customer=self.kumar.pk)
        totals = data['results'][0]['totals']
        rows = data['results'][0]['rows']
        expected_debit = sum(Decimal(str(row['debit'])) for row in rows)
        expected_credit = sum(Decimal(str(row['credit'])) for row in rows)
        self.assertEqual(Decimal(str(totals['debit'])), expected_debit)
        self.assertEqual(Decimal(str(totals['credit'])), expected_credit)
        self.assertEqual(Decimal(str(totals['total'])), expected_debit + expected_credit)

    def test_filters_by_customer_and_loan_type(self):
        self.loan(self.kumar, 'Chit')
        self.loan(self.kumar, 'Interest')
        self.loan(self.ravi, 'Chit')
        data = self.report(customer=self.kumar.pk, loan_type='Chit')
        self.assertEqual(len(data['results']), 1)
        self.assertEqual(data['results'][0]['customer']['name'], 'Kumar')
        rows = [row for row in data['results'][0]['rows'] if row['particulars'] != 'Opening Balance']
        self.assertTrue(all('Report Group' in row['particulars'] for row in rows))

    def test_loan_id_scopes_to_one_loan_and_omits_opening_balance(self):
        """The per-loan detail page passes loan_id so a customer with several loans sees
        only that one loan's own Debit/Credit rows — never another loan's receipts, and
        never the customer-level Opening Balance (that belongs on the customer header,
        not repeated inside every loan's statement)."""
        Ledger.objects.filter(customer=self.kumar).update(opening_balance=Decimal('500.00'))
        chit_loan = self.loan(self.kumar, 'Chit')
        interest_loan = self.loan(self.kumar, 'Interest')
        from .models import CollectionTransaction
        chit_installment = self.kumar.customer_loans.get(pk=chit_loan['id']).installment_details.order_by('installment_number').first()
        interest_installment = self.kumar.customer_loans.get(pk=interest_loan['id']).installment_details.order_by('installment_number').first()
        CollectionTransaction.objects.create(installment=chit_installment, loan=chit_installment.loan, customer=self.kumar,
                                              collection_amount=Decimal('20.00'), collection_date=timezone.localdate())
        CollectionTransaction.objects.create(installment=interest_installment, loan=interest_installment.loan, customer=self.kumar,
                                              collection_amount=Decimal('30.00'), collection_date=timezone.localdate())

        data = self.report(customer=self.kumar.pk, loan_id=chit_loan['id'])
        rows = data['results'][0]['rows']
        self.assertTrue(all(row['particulars'] != 'Opening Balance' for row in rows))
        debit_rows = [row for row in rows if row['particulars'] != 'Receipt']
        self.assertTrue(all(row['voucher_no'] == chit_loan['doc_no'] for row in debit_rows))
        receipt_rows = [row for row in rows if row['particulars'] == 'Receipt']
        self.assertEqual(len(receipt_rows), 1)
        self.assertEqual(Decimal(str(receipt_rows[0]['credit'])), Decimal('20.00'))

    def test_rejects_invalid_dates(self):
        response = self.client.get('/api/finance/reports/customer-wise/', {'from': 'bad'})
        self.assertEqual(response.status_code, 400)
