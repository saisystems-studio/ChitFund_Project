from .test_support import ensure_cash_ledger
import io
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path

from PIL import Image
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import UserProfile
from customers.models import Customer
from .models import (ChitGroup, ChitGroupInstallmentDetail, CollectionTransaction, CustomerLoanDetails,
                     LoanInstallment, LoanKycDocument, LoanType, PaymentEntry, TransactionDocument)

REPORT = '/api/finance/reports/today/'


def jpeg(name='proof.jpg', colour='white'):
    data = io.BytesIO()
    Image.new('RGB', (4, 4), colour).save(data, 'JPEG')
    return SimpleUploadedFile(name, data.getvalue(), content_type='image/jpeg')


class TodayReportDocumentTests(TestCase):
    """Today Report attachments: Loan rows reuse loan KYC documents; Receipt and Payment rows
    own TransactionDocument rows. Private storage, per-transaction scoping, retry safety and
    KYC permissions all apply; attaching never changes the financial record."""

    def setUp(self):
        ensure_cash_ledger()
        private, media = tempfile.TemporaryDirectory(), tempfile.TemporaryDirectory()
        self.addCleanup(private.cleanup)
        self.addCleanup(media.cleanup)
        self.private = private.name
        override = override_settings(KYC_PRIVATE_ROOT=private.name, MEDIA_ROOT=media.name)
        override.enable()
        self.addCleanup(override.disable)
        self.client = APIClient()
        self.admin = User.objects.create_user('docs-admin', is_staff=True)
        self.client.force_authenticate(self.admin)
        self.kumar = Customer.objects.create(customer_code='TD001', full_name='Kumar', primary_mobile='9876500201', role='BORROWER')
        self.types = {name: LoanType.objects.get_or_create(name=name)[0] for name in ('Chit', 'Interest', 'Mortgage')}
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='TDG', name='Docs Group', duration=3, duration_type='DAY')
        for number in (1, 2, 3):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=number, schedule_value=str(number), installment_amount=50)
        self.today = timezone.localdate().isoformat()
        self.loan = self.make_loan()
        self.receipt_a = self.collect('40')
        self.receipt_b = self.collect('30')  # same customer and loan as receipt_a
        self.payment = self.make_payment()

    def make_loan(self):
        response = self.client.post('/api/finance/loans/', {'customer_id': self.kumar.pk, 'loan_type_id': self.types['Chit'].pk, 'amount': '100',
                                    'start_date': self.today, 'interest_percentage': '10', 'periodicity': 'Daily', 'interest_duration': 3,
                                    'chit_group_id': self.group.pk, 'include_sunday': True}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return CustomerLoanDetails.objects.get(pk=response.data['id'])

    def collect(self, amount):
        installment = self.loan.installment_details.order_by('installment_number').first()
        response = self.client.post(f'/api/finance/customer-loan-installments/{installment.id}/collect/',
                                    {'payment_date': self.today, 'customer_paid_amount': amount, 'payment_mode': 'Cash'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        return CollectionTransaction.objects.get(pk=response.data['collection_id'])

    def make_payment(self):
        ledger = self.client.post('/api/finance/ledgers/', {'name': 'Office Rent', 'group': 'Indirect Expense'}, format='json')
        response = self.client.post('/api/finance/payment-entries/', {'ledger': ledger.data['id'], 'accounts': 'Card', 'amount': '75.50',
                                    'payment_mode': 'Cash', 'date': self.today}, format='json')
        self.assertEqual(response.status_code, 201, getattr(response, 'data', None))
        return PaymentEntry.objects.get(pk=response.data['id'])

    def url(self, kind, owner_id, document_id=None):
        return f'/api/finance/transaction-documents/{kind}/{owner_id}/' + (f'{document_id}/file/' if document_id else '')

    def attach(self, kind, owner_id, upload=None, **extra):
        return self.client.post(self.url(kind, owner_id), {'document_type': 'AADHAAR', 'file': upload or jpeg(), **extra}, format='multipart')

    def report_rows(self):
        response = self.client.get(REPORT)
        self.assertEqual(response.status_code, 200)
        return {row['key']: row for row in response.data['rows']}, response.data

    def read(self, response):
        # Consume the stream so the test client closes the file response itself.
        return b''.join(response.streaming_content)

    def test_all_three_transaction_types_appear_with_ids_and_zero_documents(self):
        rows, data = self.report_rows()
        self.assertTrue(data['documents_allowed'])
        expected = {f'LOAN-{self.loan.id}': self.loan.id, f'RECEIPT-{self.receipt_a.id}': self.receipt_a.id,
                    f'RECEIPT-{self.receipt_b.id}': self.receipt_b.id, f'PAYMENT-{self.payment.id}': self.payment.id}
        self.assertEqual({key: row['transaction_id'] for key, row in rows.items()}, expected)
        self.assertEqual({row['document_count'] for row in rows.values()}, {0})

    def test_existing_loan_kyc_documents_are_counted_on_the_loan_row_without_reupload(self):
        response = self.client.post(f'/api/finance/loans/{self.loan.id}/kyc-documents/', {'document_type': 'PAN', 'file': jpeg()}, format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        rows, _ = self.report_rows()
        self.assertEqual(rows[f'LOAN-{self.loan.id}']['document_count'], 1)
        self.assertEqual(rows[f'RECEIPT-{self.receipt_a.id}']['document_count'], 0)
        self.assertEqual(LoanKycDocument.objects.count(), 1)
        self.assertEqual(TransactionDocument.objects.count(), 0)

    def test_receipt_document_stays_on_its_own_receipt(self):
        saved = self.attach('receipt', self.receipt_a.id)
        self.assertEqual(saved.status_code, 201, saved.data)
        document = TransactionDocument.objects.get(pk=saved.data['id'])
        self.assertEqual((document.collection_id, document.payment_id), (self.receipt_a.id, None))
        self.assertEqual([d['id'] for d in self.client.get(self.url('receipt', self.receipt_a.id)).data], [document.id])
        self.assertEqual(self.client.get(self.url('receipt', self.receipt_b.id)).data, [])
        self.assertEqual(self.client.get(self.url('payment', self.payment.id)).data, [])
        # The document id cannot be read through a sibling receipt (same customer + loan) or another kind.
        self.assertEqual(self.client.get(self.url('receipt', self.receipt_b.id, document.id)).status_code, 404)
        self.assertEqual(self.client.get(self.url('payment', self.payment.id, document.id)).status_code, 404)
        rows, _ = self.report_rows()
        self.assertEqual([rows[f'RECEIPT-{self.receipt_a.id}']['document_count'], rows[f'RECEIPT-{self.receipt_b.id}']['document_count'],
                          rows[f'LOAN-{self.loan.id}']['document_count']], [1, 0, 0])

    def test_payment_supports_multiple_attachments_view_and_download(self):
        first = self.attach('payment', self.payment.id, jpeg('bill.jpg', 'white'))
        second = self.attach('payment', self.payment.id, jpeg('voucher.jpg', 'black'), document_type='OTHER', other_document_name='Bill Copy')
        self.assertEqual((first.status_code, second.status_code), (201, 201), (first.data, second.data))
        self.assertEqual(len(self.client.get(self.url('payment', self.payment.id)).data), 2)
        rows, _ = self.report_rows()
        self.assertEqual(rows[f'PAYMENT-{self.payment.id}']['document_count'], 2)
        document = TransactionDocument.objects.get(pk=second.data['id'])
        view = self.client.get(self.url('payment', self.payment.id, document.id))
        self.assertEqual(view.status_code, 200)
        self.assertEqual(view['Content-Type'], 'image/jpeg')
        self.assertIn('no-store', view['Cache-Control'])
        self.assertNotIn('attachment', view.get('Content-Disposition', ''))
        with document.file.open('rb') as stored:
            self.assertEqual(self.read(view), stored.read())
        download = self.client.get(self.url('payment', self.payment.id, document.id) + '?download=1')
        self.assertIn('attachment', download['Content-Disposition'])
        self.assertIn('voucher.jpg', download['Content-Disposition'])
        self.read(download)

    def test_files_are_private_with_no_public_url(self):
        saved = self.attach('receipt', self.receipt_a.id)
        document = TransactionDocument.objects.get(pk=saved.data['id'])
        self.assertTrue(Path(document.file.path).resolve().is_relative_to(Path(self.private).resolve()))
        self.assertIn(f'transaction_documents/receipt_{self.receipt_a.id}/', document.file.name)
        with self.assertRaises(ValueError):
            _ = document.file.url
        self.assertNotIn('file', saved.data)

    def test_retry_with_same_token_reuses_document_and_token_cannot_move(self):
        token = str(uuid.uuid4())
        upload = jpeg()
        content = upload.read()
        responses = [self.attach('receipt', self.receipt_a.id, SimpleUploadedFile('proof.jpg', content, content_type='image/jpeg'), upload_token=token) for _ in range(2)]
        self.assertEqual([r.status_code for r in responses], [201, 201])
        self.assertEqual(responses[0].data['id'], responses[1].data['id'])
        self.assertEqual(TransactionDocument.objects.count(), 1)
        moved = self.attach('receipt', self.receipt_b.id, SimpleUploadedFile('proof.jpg', content, content_type='image/jpeg'), upload_token=token)
        self.assertEqual(moved.status_code, 400)
        self.assertEqual(TransactionDocument.objects.filter(collection=self.receipt_b).count(), 0)

    def test_untokened_uploads_can_coexist(self):
        # Nullable unique upload_token must allow many NULLs (SQL Server filtered unique index).
        for _ in range(2):
            self.assertEqual(self.attach('receipt', self.receipt_a.id).status_code, 201)
        self.assertEqual(TransactionDocument.objects.filter(upload_token__isnull=True).count(), 2)

    def test_attaching_never_changes_financial_records(self):
        def snapshot():
            receipt = CollectionTransaction.objects.values().get(pk=self.receipt_a.pk)
            payment = PaymentEntry.objects.values().get(pk=self.payment.pk)
            loan = CustomerLoanDetails.objects.values().get(pk=self.loan.pk)
            return receipt, payment, loan
        before = snapshot()
        self.attach('receipt', self.receipt_a.id)
        self.attach('payment', self.payment.id)
        self.client.post(f'/api/finance/loans/{self.loan.id}/kyc-documents/', {'document_type': 'PAN', 'file': jpeg()}, format='multipart')
        self.assertEqual(snapshot(), before)

    def test_invalid_content_kind_and_owner_are_rejected(self):
        bad = SimpleUploadedFile('id.jpg', b'<script>bad</script>', content_type='image/jpeg')
        self.assertEqual(self.attach('receipt', self.receipt_a.id, bad).status_code, 400)
        self.assertEqual(self.attach('receipt', self.receipt_a.id, document_type='OTHER').status_code, 400)
        self.assertEqual(self.client.get(self.url('loan', self.loan.id)).status_code, 404)
        self.assertEqual(self.client.get(self.url('receipt', 999999)).status_code, 404)
        self.assertEqual(TransactionDocument.objects.count(), 0)
        self.assertFalse(any(Path(self.private).rglob('*.jpg')))

    def test_document_must_have_exactly_one_owner(self):
        fields = {'document_type': 'PAN', 'file': 'x.jpg', 'original_file_name': 'x.jpg', 'file_type': 'image/jpeg'}
        with self.assertRaises(IntegrityError), transaction.atomic():  # database: never both
            TransactionDocument.objects.create(collection=self.receipt_a, payment=self.payment, **fields)
        with self.assertRaises(ValueError):  # model: never neither
            TransactionDocument.objects.create(**fields)
        self.assertEqual(TransactionDocument.objects.count(), 0)

    def test_deleting_the_receipt_removes_its_documents_and_files(self):
        saved = self.attach('receipt', self.receipt_b.id)
        document = TransactionDocument.objects.get(pk=saved.data['id'])
        storage, name = document.file.storage, document.file.name
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.delete(f'/api/finance/collection-transactions/{self.receipt_b.id}/')
        self.assertIn(response.status_code, (200, 204), getattr(response, 'data', None))
        self.assertFalse(TransactionDocument.objects.filter(pk=document.pk).exists())
        self.assertFalse(storage.exists(name))

    def test_view_only_user_sees_report_but_no_document_access(self):
        saved = self.attach('receipt', self.receipt_a.id)
        viewer = User.objects.create_user('docs-viewer')
        UserProfile.objects.create(user=viewer, can_write=False)
        self.client.force_authenticate(viewer)
        rows, data = self.report_rows()
        self.assertFalse(data['documents_allowed'])
        self.assertEqual({row['document_count'] for row in rows.values()}, {None})
        self.assertEqual(self.client.get(self.url('receipt', self.receipt_a.id)).status_code, 403)
        self.assertEqual(self.client.get(self.url('receipt', self.receipt_a.id, saved.data['id'])).status_code, 403)
        self.assertEqual(self.attach('receipt', self.receipt_a.id).status_code, 403)
        self.assertEqual(self.attach('payment', self.payment.id).status_code, 403)
        self.assertEqual(self.client.get(f'/api/finance/loans/{self.loan.id}/kyc-documents/').status_code, 403)
        self.assertEqual(TransactionDocument.objects.count(), 1)

    def test_entry_user_may_view_and_attach_and_anonymous_is_denied(self):
        entry = User.objects.create_user('docs-entry')
        UserProfile.objects.create(user=entry, can_write=True)
        self.client.force_authenticate(entry)
        self.assertTrue(self.report_rows()[1]['documents_allowed'])
        saved = self.attach('payment', self.payment.id)
        self.assertEqual(saved.status_code, 201, saved.data)
        view = self.client.get(self.url('payment', self.payment.id, saved.data['id']))
        self.assertEqual(view.status_code, 200)
        self.assertTrue(self.read(view))
        self.client.force_authenticate(None)
        for response in (self.client.get(self.url('payment', self.payment.id)), self.client.get(self.url('payment', self.payment.id, saved.data['id'])),
                         self.attach('payment', self.payment.id)):
            self.assertIn(response.status_code, (401, 403))
