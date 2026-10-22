import io
import tempfile
import uuid
from unittest.mock import patch

from PIL import Image
from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import UserProfile
from customers.models import Customer, CustomerKycDocument
from customers.serializers import CustomerKycDocumentSerializer
from finance.serializers import LoanKycDocumentSerializer


def image_upload(name='photo.jpg'):
    data = io.BytesIO()
    Image.new('RGB', (4, 4), 'white').save(data, 'JPEG')
    return SimpleUploadedFile(name, data.getvalue(), content_type='image/jpeg')


class KycContentTests(SimpleTestCase):
    def test_both_serializers_reject_disguised_content(self):
        for serializer in (CustomerKycDocumentSerializer, LoanKycDocumentSerializer):
            with self.subTest(serializer=serializer.__name__), self.assertRaises(ValidationError):
                serializer().validate_file(SimpleUploadedFile('id.jpg', b'<script>bad</script>', content_type='image/jpeg'))

    def test_both_serializers_accept_real_camera_jpeg(self):
        for serializer in (CustomerKycDocumentSerializer, LoanKycDocumentSerializer):
            self.assertEqual(serializer().validate_file(image_upload()).content_type, 'image/jpeg')

    def test_both_serializers_reject_oversize_and_mismatched_extension(self):
        for serializer in (CustomerKycDocumentSerializer, LoanKycDocumentSerializer):
            for upload in (SimpleUploadedFile('big.jpg', b'x' * (5 * 1024 * 1024 + 1), content_type='image/jpeg'), image_upload('id.png')):
                with self.assertRaises(ValidationError):
                    serializer().validate_file(upload)


class KycStorageTests(TestCase):
    def setUp(self):
        self.private = tempfile.TemporaryDirectory()
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.private.cleanup)
        self.addCleanup(self.media.cleanup)
        self.settings_override = override_settings(KYC_PRIVATE_ROOT=self.private.name, MEDIA_ROOT=self.media.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('secure-admin', is_staff=True))
        self.customer = Customer.objects.create(customer_code='SEC001', full_name='Secure', primary_mobile='9999999999')
        self.url = f'/api/customers/{self.customer.pk}/kyc-documents/'

    def upload(self):
        return self.client.post(self.url, {'document_type': 'AADHAAR', 'file': image_upload()}, format='multipart')

    def test_private_storage_has_no_url_and_authenticated_response_is_not_cached(self):
        response = self.upload()
        self.assertEqual(response.status_code, 201, response.data)
        doc = CustomerKycDocument.objects.get(pk=response.data['id'])
        self.assertTrue(doc.file.path.startswith(self.private.name))
        with self.assertRaises(ValueError):
            _ = doc.file.url
        download = self.client.get(f'{self.url}{doc.pk}/file/')
        self.assertEqual(download.status_code, 200)
        self.assertIn('no-store', download['Cache-Control'])
        # Exhaust the stream so the test client closes the response (and its file handle) itself.
        # Calling download.close() directly fires request_finished -> close_old_connections, which
        # closes the DB connection mid-TestCase on real servers (SQL Server); in-memory SQLite hid it.
        with doc.file.open('rb') as stored:
            self.assertEqual(b''.join(download.streaming_content), stored.read())
        self.assertTrue(download.closed)

    def test_view_only_user_cannot_read_private_documents(self):
        response = self.upload()
        user = User.objects.create_user('view-only')
        UserProfile.objects.create(user=user, can_write=False)
        self.client.force_authenticate(user)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.client.get(f"{self.url}{response.data['id']}/file/").status_code, 403)

    def test_failed_database_save_removes_uploaded_file(self):
        from pathlib import Path
        with patch.object(CustomerKycDocument, 'save', side_effect=RuntimeError('save failed')):
            with self.assertRaises(RuntimeError):
                self.upload()
        self.assertFalse(any(Path(self.private.name).rglob('*.jpg')))

    def test_parent_deletion_removes_private_file(self):
        response = self.upload()
        doc = CustomerKycDocument.objects.get(pk=response.data['id'])
        storage, name = doc.file.storage, doc.file.name
        with self.captureOnCommitCallbacks(execute=True):
            self.customer.delete()
        self.assertFalse(storage.exists(name))

    def test_retry_after_lost_response_reuses_document(self):
        token = str(uuid.uuid4())
        responses = [self.client.post(self.url, {'document_type': 'AADHAAR', 'upload_token': token,
                                                'file': image_upload()}, format='multipart') for _ in range(2)]
        self.assertEqual(responses[0].data['id'], responses[1].data['id'])
        self.assertEqual(CustomerKycDocument.objects.count(), 1)

    def test_concurrent_retry_rewinds_consumed_upload_in_recovery(self):
        from django.db import IntegrityError
        from customers.kyc_security import create_kyc_document
        token = uuid.uuid4()
        saved = self.client.post(self.url, {'document_type': 'AADHAAR', 'upload_token': str(token), 'file': image_upload()}, format='multipart')
        original_filter = CustomerKycDocument.objects.filter
        calls = 0
        def racing_filter(**kwargs):
            nonlocal calls
            calls += 1
            return original_filter(pk=-1) if calls == 1 else original_filter(**kwargs)
        with patch.object(CustomerKycDocument.objects, 'filter', side_effect=racing_filter), patch.object(CustomerKycDocument, 'save', side_effect=IntegrityError('duplicate token')):
            reused = create_kyc_document(CustomerKycDocument, {'customer': self.customer, 'document_type': 'AADHAAR',
                        'upload_token': token, 'file': image_upload()})
        self.assertEqual(reused.pk, saved.data['id'])

    def test_existing_media_attachment_is_read_without_moving_it(self):
        from pathlib import Path
        name = f'kyc_documents/customer_{self.customer.pk}/legacy.jpg'
        path = Path(self.media.name) / name
        path.parent.mkdir(parents=True)
        path.write_bytes(image_upload().read())
        doc = CustomerKycDocument.objects.create(customer=self.customer, document_type='AADHAAR',
                    file=name, original_file_name='legacy.jpg', file_type='image/jpeg', file_size=path.stat().st_size)
        response = self.client.get(f'{self.url}{doc.pk}/file/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b''.join(response.streaming_content), path.read_bytes())
        self.assertTrue(response.closed)  # closed by the test client once the stream was consumed
        self.assertTrue(path.exists())
        self.assertFalse((Path(self.private.name) / name).exists())

    def test_token_cannot_be_reused_for_another_customer(self):
        token = str(uuid.uuid4())
        self.client.post(self.url, {'document_type': 'AADHAAR', 'upload_token': token, 'file': image_upload()}, format='multipart')
        other = Customer.objects.create(customer_code='SEC002', full_name='Other', primary_mobile='9999999998')
        response = self.client.post(f'/api/customers/{other.pk}/kyc-documents/',
                    {'document_type': 'AADHAAR', 'upload_token': token, 'file': image_upload()}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(CustomerKycDocument.objects.count(), 1)

    def test_registry_failure_rolls_back_document_and_removes_file(self):
        from pathlib import Path
        with patch('customers.models.CustomerDocumentType.objects.get_or_create', side_effect=RuntimeError('registry failed')):
            with self.assertRaises(RuntimeError):
                self.client.post(self.url, {'document_type': 'OTHER', 'other_document_name': 'Employee ID',
                                            'file': image_upload()}, format='multipart')
        self.assertEqual(CustomerKycDocument.objects.count(), 0)
        self.assertFalse(any(Path(self.private.name).rglob('*.jpg')))
