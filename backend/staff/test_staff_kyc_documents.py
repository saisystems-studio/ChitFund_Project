import os
import shutil
import tempfile
import uuid
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import UserProfile
from customers.kyc_test_files import valid_document_bytes
from .models import Staff, StaffKycDocument

MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=MEDIA_ROOT, KYC_PRIVATE_ROOT=MEDIA_ROOT + "-private")
class StaffKycDocumentTests(TestCase):
    """Staff KYC uses the same document rules as customer/loan KYC, scoped to one staff member."""

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA_ROOT, ignore_errors=True)
        shutil.rmtree(MEDIA_ROOT + "-private", ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user('staff-kyc-admin', is_staff=True)
        self.writer = User.objects.create_user('staff-kyc-writer')
        UserProfile.objects.create(user=self.writer, can_write=True)
        self.client.force_authenticate(self.admin)
        self.staff = Staff.objects.create(staff_id='STF-9001', staff_name='Kavitha', phone_number='9876500100')
        self.other = Staff.objects.create(staff_id='STF-9002', staff_name='Suresh', phone_number='9876500101')

    def url(self, staff, document_id=None, suffix=''):
        return f'/api/staff/{staff.pk}/kyc-documents/' + (f'{document_id}/{suffix}' if document_id else '')

    def upload(self, staff, filename='aadhaar.pdf', content_type='application/pdf', **extra):
        payload = {'document_type': 'AADHAAR', 'file': SimpleUploadedFile(filename, valid_document_bytes(filename), content_type=content_type), **extra}
        return self.client.post(self.url(staff), payload, format='multipart')

    def test_upload_list_view_and_download(self):
        created = self.upload(self.staff)
        self.assertEqual(created.status_code, 201, created.data)
        listed = self.client.get(self.url(self.staff)).data
        self.assertEqual([(row['document_type'], row['original_file_name']) for row in listed], [('AADHAAR', 'aadhaar.pdf')])
        self.assertEqual(self.client.get(self.url(self.other)).data, [])
        viewed = self.client.get(self.url(self.staff, created.data['id'], 'file/'))
        self.assertEqual((viewed.status_code, viewed['Content-Type']), (200, 'application/pdf'))
        downloaded = self.client.get(self.url(self.staff, created.data['id'], 'file/') + '?download=1')
        self.assertIn('attachment', downloaded['Content-Disposition'])

    def test_document_is_scoped_to_its_staff(self):
        created = self.upload(self.staff).data
        self.assertEqual(self.client.get(self.url(self.other, created['id'], 'file/')).status_code, 404)
        self.assertEqual(self.client.delete(self.url(self.other, created['id'])).status_code, 404)

    def test_other_requires_a_name_and_invalid_files_are_rejected(self):
        self.assertEqual(self.upload(self.staff, document_type='OTHER').status_code, 400)
        self.assertEqual(self.upload(self.staff, document_type='OTHER', other_document_name='Driving Badge').status_code, 201)
        bad = self.client.post(self.url(self.staff), {'document_type': 'PAN', 'file': SimpleUploadedFile('pan.pdf', b'not a pdf', content_type='application/pdf')}, format='multipart')
        self.assertEqual(bad.status_code, 400)

    def test_retried_upload_token_is_saved_once(self):
        token = str(uuid.uuid4())
        first = self.upload(self.staff, upload_token=token)
        second = self.upload(self.staff, upload_token=token)
        self.assertEqual((first.status_code, second.status_code, first.data['id']), (201, 201, second.data['id']))
        self.assertEqual(StaffKycDocument.objects.filter(staff=self.staff).count(), 1)

    def test_delete_is_admin_only_and_removes_the_file(self):
        created = self.upload(self.staff).data
        path = StaffKycDocument.objects.get(pk=created['id']).file.path
        self.client.force_authenticate(self.writer)
        self.assertEqual(self.upload(self.staff, filename='pan.pdf').status_code, 201)
        self.assertEqual(self.client.delete(self.url(self.staff, created['id'])).status_code, 403)
        self.client.force_authenticate(self.admin)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.delete(self.url(self.staff, created['id'])).status_code, 204)
        self.assertFalse(StaffKycDocument.objects.filter(pk=created['id']).exists())
        self.assertFalse(os.path.exists(path))

    def test_view_only_user_cannot_access_documents(self):
        self.client.force_authenticate(User.objects.create_user('staff-kyc-viewer'))
        self.assertEqual(self.client.get(self.url(self.staff)).status_code, 403)


class StaffDateFieldTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('staff-date-admin', is_staff=True))

    def post(self, **extra):
        return self.client.post('/api/staff/', {'staff_name': 'Anitha', 'phone_number': '9876500200', **extra}, format='json')

    def test_dates_save_and_fetch_and_anniversary_is_optional(self):
        created = self.post(date_of_birth='1990-05-14')
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual((created.data['date_of_birth'], created.data['anniversary_date']), ('1990-05-14', None))
        updated = self.client.patch(f"/api/staff/{created.data['id']}/", {'anniversary_date': '2015-02-10'}, format='json')
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(self.client.get(f"/api/staff/{created.data['id']}/").data['anniversary_date'], '2015-02-10')

    def test_dates_are_validated(self):
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
        self.assertIn('date_of_birth', self.post(date_of_birth=tomorrow).data)
        self.assertIn('anniversary_date', self.post(date_of_birth='1990-05-14', anniversary_date='1989-01-01').data)

    def test_existing_callers_without_dates_still_work(self):
        self.assertEqual(self.post().status_code, 201)
