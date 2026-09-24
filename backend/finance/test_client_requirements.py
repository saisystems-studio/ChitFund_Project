from datetime import timedelta
from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer
from .models import (ChitGroup, ChitGroupInstallmentDetail, CollectionTransaction,
                     CustomerLoanDetails, LoanInstallment, LoanType, Mortgage)


class ClientRequirementsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('requirements-admin', is_staff=True))
        self.customer = Customer.objects.create(customer_code='REQ001', full_name='Test Customer',
                                                primary_mobile='9876543210', role='BORROWER')
        self.types = {name: LoanType.objects.get_or_create(name=name)[0] for name in ('Chit', 'Interest', 'Mortgage')}
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='REQ', name='Test Group', duration=2, duration_type='DAY')
        for number in (1, 2):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=number,
                                                     schedule_value=str(number), installment_amount=50)

    def loan(self, kind='Mortgage', **extra):
        payload = {'customer_id': self.customer.pk, 'loan_type_id': self.types[kind].pk,
                   'amount': '100', 'start_date': timezone.localdate().isoformat(),
                   'interest_percentage': '10', 'periodicity': 'Daily', 'interest_duration': 2,
                   'chit_group_id': self.group.pk, 'include_sunday': True, **extra}
        response = self.client.post('/api/finance/loans/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_mortgage_optional_collateral_and_unchanged_finance_calculation(self):
        loan = self.loan(quantity='', mortgage_product_id='')
        self.assertIsNone(loan['mortgage_details']['product'])
        self.assertIsNone(loan['mortgage_details']['quantity'])
        self.assertEqual(Decimal(str(loan['total_amount'])), Decimal('100.03'))
        self.assertEqual(len(loan['installments']), 1)
        response = self.client.patch(f"/api/finance/loans/{loan['id']}/", {'amount': '200'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data['mortgage_details']['product'])

    def test_mortgage_can_clear_collateral_and_preserve_rate_when_omitted(self):
        product = Mortgage.objects.create(product_name='Gold', unit='Gram', current_rate=100)
        loan = self.loan(quantity='2', mortgage_product_id=product.pk)
        product.current_rate = 200
        product.save()
        url = f"/api/finance/loans/{loan['id']}/"
        response = self.client.patch(url, {'amount': '150'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Decimal(str(response.data['mortgage_details']['current_rate'])), 100)
        response = self.client.patch(url, {'quantity': '', 'mortgage_product_id': ''}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data['mortgage_details']['product'])
        self.assertEqual(response.data['mortgage_details']['unit'], '')

    def test_mortgage_rejects_invalid_supplied_collateral(self):
        for extra in ({'quantity': '-1'}, {'quantity': 'nonsense'}, {'mortgage_product_id': 999999}):
            response = self.client.post('/api/finance/loans/', {
                'customer_id': self.customer.pk, 'loan_type_id': self.types['Mortgage'].pk,
                'amount': '100', 'interest_percentage': '10', **extra}, format='json')
            self.assertEqual(response.status_code, 400, response.data)

    def test_document_numbers_independent_stable_and_never_reused_after_delete(self):
        for kind, prefix in (('Chit', 'CH'), ('Interest', 'IN'), ('Mortgage', 'M')):
            first, second = self.loan(kind), self.loan(kind)
            self.assertEqual(first['doc_no'], f'{prefix}-0001')
            self.assertEqual(second['doc_no'], f'{prefix}-0002')
            legacy = CustomerLoanDetails.objects.get(pk=first['id']).loan_no
            response = self.client.patch(f"/api/finance/loans/{first['id']}/", {'amount': '120', 'doc_no': 'FAKE'}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data['doc_no'], first['doc_no'])
            self.assertEqual(CustomerLoanDetails.objects.get(pk=first['id']).loan_no, legacy)
            self.assertEqual(self.client.delete(f"/api/finance/loans/{second['id']}/").status_code, 204)
            self.assertEqual(self.loan(kind)['doc_no'], f'{prefix}-0003')

    def test_application_date_is_server_generated_and_immutable(self):
        for kind in self.types:
            loan = self.loan(kind, application_date='2001-01-01')
            record = CustomerLoanDetails.objects.get(pk=loan['id'])
            self.assertEqual(record.application_date, timezone.localdate())
            response = self.client.patch(f"/api/finance/loans/{loan['id']}/", {'application_date': '2002-01-01'}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
            record.refresh_from_db()
            self.assertEqual(record.application_date, timezone.localdate())

    def test_loan_type_status_and_search_filters_combine(self):
        chit = self.loan('Chit')
        interest = self.loan('Interest', start_date=(timezone.localdate() - timedelta(days=5)).isoformat())
        self.loan('Mortgage')
        def ids(**params):
            response = self.client.get('/api/finance/loans/', params)
            self.assertEqual(response.status_code, 200, response.data)
            return [row['id'] for row in response.data['results']]
        self.assertEqual(ids(loan_type='Chit', status='Active', search='CH-0001'), [chit['id']])
        self.assertEqual(ids(loan_type='Interest', status='Overdue', search='9876543210'), [interest['id']])
        self.assertEqual(ids(loan_type='Mortgage', status='Overdue'), [])
        self.assertEqual(len(ids(loan_type='ALL', status='ALL')), 3)

    def test_mortgage_report_contains_snapshots_without_other_loans(self):
        self.loan('Chit')
        loan = self.loan(amount='100')
        response = self.client.patch(f"/api/finance/loans/{loan['id']}/", {'amount': '200'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.get('/api/finance/reports/mortgage/')
        self.assertEqual(response.status_code, 200, getattr(response, 'data', None))
        rows = response.data['results']
        self.assertEqual([row['action'] for row in rows], ['UPDATED', 'CREATED'])
        self.assertEqual([Decimal(row['snapshot']['loan_amount']) for row in rows], [Decimal('200'), Decimal('100')])
        self.assertTrue(all(row['loan_id'] == loan['id'] for row in rows))

    def test_explicit_all_status_includes_completed_without_changing_default_list(self):
        loan = self.loan('Chit')
        response = self.client.post(f"/api/finance/customer-loan-installments/{loan['installments'][0]['id']}/collect/",
            {'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': '100'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.client.get('/api/finance/loans/').data['count'], 0)
        for status in ('ALL', 'Completed'):
            response = self.client.get('/api/finance/loans/', {'loan_type': 'Chit', 'status': status})
            self.assertEqual(response.data['count'], 1, response.data)
            self.assertEqual(response.data['results'][0]['doc_no'], loan['doc_no'])

    def test_ledger_crud_and_exact_group_validation(self):
        url = '/api/finance/ledgers/'
        for payload in ({'group': 'Income'}, {'name': 'Missing group'}, {'name': 'Invalid', 'group': 'Other'}):
            self.assertEqual(self.client.post(url, payload, format='json').status_code, 400)
        response = self.client.post(url, {'name': ' Office ', 'group': 'Indirect Expense', 'opening_balance': '100.25'}, format='json')
        self.assertEqual(response.status_code, 201, getattr(response, 'data', None))
        pk = response.data['id']
        self.assertEqual(self.client.get(f'{url}{pk}/').data['name'], 'Office')
        response = self.client.patch(f'{url}{pk}/', {'opening_balance': '200.00'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Decimal(response.data['opening_balance']), Decimal('200'))
        self.assertEqual(self.client.delete(f'{url}{pk}/').status_code, 204)

    def test_collection_backdated_date_is_persisted(self):
        loan = self.loan('Chit')
        paid_on = timezone.localdate() - timedelta(days=2)
        response = self.client.post(f"/api/finance/customer-loan-installments/{loan['installments'][0]['id']}/collect/",
                                    {'payment_date': paid_on.isoformat(), 'customer_paid_amount': '10', 'payment_mode': 'Cash'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(CollectionTransaction.objects.get(loan_id=loan['id']).collection_date, paid_on)

    def test_payment_entry_persists_ledger_mode_details_and_backdate(self):
        ledger = self.client.post('/api/finance/ledgers/', {'name': 'Rent', 'group': 'Indirect Expense'}, format='json')
        self.assertEqual(ledger.status_code, 201, getattr(ledger, 'data', None))
        paid_on = (timezone.localdate() - timedelta(days=2)).isoformat()
        payload = {'ledger': ledger.data['id'], 'accounts': 'Card', 'amount': '75.50',
                   'payment_mode': 'UPI', 'date': paid_on, 'upi_id': 'test@upi', 'transaction_utr': 'REQ123'}
        response = self.client.post('/api/finance/payment-entries/', payload, format='json')
        self.assertEqual(response.status_code, 201, getattr(response, 'data', None))
        saved = self.client.get(f"/api/finance/payment-entries/{response.data['id']}/").data
        self.assertEqual(saved['date'], paid_on)
        self.assertEqual(saved['ledger'], ledger.data['id'])
        self.assertEqual(saved['transaction_utr'], 'REQ123')
        self.assertEqual(Decimal(saved['amount']), Decimal('75.50'))
        self.assertEqual(self.client.delete(f"/api/finance/ledgers/{ledger.data['id']}/").status_code, 409)
        for invalid in ({'amount': '0'}, {'accounts': 'Debit'}, {'payment_mode': 'Other'}, {'ledger': None}, {'upi_id': ''}):
            response = self.client.post('/api/finance/payment-entries/', {**payload, **invalid}, format='json')
            self.assertEqual(response.status_code, 400, response.data)

    def test_new_writes_require_write_permission(self):
        self.client.force_authenticate(User.objects.create_user('requirements-reader'))
        for path in ('ledgers', 'payment-entries'):
            self.assertEqual(self.client.post(f'/api/finance/{path}/', {}, format='json').status_code, 403)
