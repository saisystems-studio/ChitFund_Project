from decimal import Decimal

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient

from .models import CollectionTransaction
from . import test_collection_receipt as _receipts

_Base = _receipts.CollectionReceiptTests


class ReportDetailTests(_Base):
    """Double-click "View More": the endpoint returns exactly the selected record, read-only."""

    # The inherited receipt tests are not re-run here.
    for _name in [name for name in dir(_Base) if name.startswith('test_')]:
        locals()[_name] = None
    del _name

    def detail(self, **params):
        return self.client.get('/api/finance/reports/detail/', params)

    def test_receipt_voucher_returns_its_postings_and_allocated_dues(self):
        loan = self.loan('Chit')
        collection = self.collect(loan, '5000')
        response = self.detail(kind='voucher', ref=f'RV-{collection.pk:06d}')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['voucher_no'], f'RV-{collection.pk:06d}')
        self.assertEqual(response.data['customer']['name'], 'Receipt Customer')
        self.assertEqual(response.data['loan']['id'], loan['id'])
        self.assertEqual([row['allocated'] for row in response.data['allocations']], [Decimal('2500.00'), Decimal('2500.00')])
        self.assertEqual(sum(row['debit'] for row in response.data['postings']), Decimal('5000.00'))
        self.assertEqual(response.data['edit'], {'kind': 'collection', 'id': collection.pk})
        self.assertEqual(response.data['documents']['kind'], 'receipt')

    def test_a_voucher_never_resolves_to_another_record(self):
        loan = self.loan('Chit')
        first, second = self.collect(loan, '2000'), self.collect(loan, '1000')
        self.assertEqual(self.detail(kind='voucher', ref=f'RV-{first.pk:06d}').data['amount'], Decimal('2000.00'))
        self.assertEqual(self.detail(kind='voucher', ref=f'RV-{second.pk:06d}').data['amount'], Decimal('1000.00'))

    def test_loan_detail_has_schedule_collections_and_highlighted_installment(self):
        loan = self.loan('Chit')
        collection = self.collect(loan, '2500')
        installment = loan['installments'][1]['id']
        response = self.detail(kind='loan', id=loan['id'], installment=installment)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['loan']['id'], loan['id'])
        self.assertEqual(response.data['highlight'], installment)
        self.assertEqual(len(response.data['schedule']), 2)
        self.assertEqual([row['voucher_no'] for row in response.data['collections']], [f'RV-{collection.pk:06d}'])
        # Stored balances are reported as saved, never recalculated here.
        self.assertEqual(response.data['loan']['paid_amount'], Decimal('2500.00'))

    def test_loan_number_resolves_a_loan_row(self):
        loan = self.loan('Chit')
        response = self.detail(kind='voucher', ref=loan['doc_no'])
        self.assertEqual((response.status_code, response.data['kind'], response.data['loan']['id']), (200, 'loan', loan['id']))

    def test_missing_or_invalid_records(self):
        self.assertEqual(self.detail(kind='voucher', ref='RV-999999').status_code, 404)
        self.assertEqual(self.detail(kind='loan', id=999999).status_code, 404)
        self.assertEqual(self.detail(kind='loan', id='abc').status_code, 400)
        self.assertEqual(self.detail(kind='voucher', ref='NOPE').status_code, 404)

    def test_read_only_for_a_normal_user_and_delete_stays_admin_only(self):
        loan = self.loan('Chit')
        collection = self.collect(loan, '2500')
        normal = APIClient()
        normal.force_authenticate(User.objects.create_user('plain-viewer'))
        self.assertEqual(normal.get('/api/finance/reports/detail/', {'kind': 'voucher', 'ref': f'RV-{collection.pk:06d}'}).status_code, 200)
        self.assertEqual(normal.post('/api/finance/reports/detail/', {}).status_code, 405)
        self.assertEqual(normal.delete(f'/api/finance/collection-transactions/{collection.pk}/').status_code, 403)
        self.assertEqual(normal.delete(f'/api/finance/loans/{loan["id"]}/').status_code, 403)
        self.assertTrue(CollectionTransaction.objects.filter(pk=collection.pk).exists())
        self.assertEqual(self.client.get('/api/finance/reports/detail/').status_code, 400)
        self.assertIsNotNone(timezone.localdate())


# Keep the shared base out of this module so the runner only collects ReportDetailTests.
del _Base
