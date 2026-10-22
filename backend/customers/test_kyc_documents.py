import shutil
import tempfile

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .kyc_test_files import valid_document_bytes
from .models import Customer

MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=MEDIA_ROOT, KYC_PRIVATE_ROOT=MEDIA_ROOT + "-private")
class CustomerKycDocumentTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA_ROOT, ignore_errors=True)
        shutil.rmtree(MEDIA_ROOT + "-private", ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('kyc-admin', is_staff=True))
        self.customer = Customer.objects.create(customer_code='KYC001', full_name='Kumar',
                                                 primary_mobile='9876500011', role='BORROWER')
        self.url = f'/api/customers/{self.customer.pk}/kyc-documents/'

    def upload(self, filename='aadhaar.jpg', content=None, content_type='image/jpeg', **extra):
        payload = {'document_type': 'AADHAAR', 'file': SimpleUploadedFile(filename, content if content is not None else valid_document_bytes(filename), content_type=content_type), **extra}
        return self.client.post(self.url, payload, format='multipart')

    def test_upload_and_list_document(self):
        response = self.upload()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['document_type_display'], 'Aadhaar Card')
        self.assertEqual(response.data['original_file_name'], 'aadhaar.jpg')

        listing = self.client.get(self.url)
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(len(listing.data), 1)

    def test_multiple_documents_for_same_customer_are_not_overwritten(self):
        self.upload(filename='aadhaar.jpg', document_type='AADHAAR')
        self.upload(filename='pan.pdf', content_type='application/pdf', document_type='PAN')
        listing = self.client.get(self.url)
        self.assertEqual(len(listing.data), 2)
        types = {row['document_type'] for row in listing.data}
        self.assertEqual(types, {'AADHAAR', 'PAN'})

    def test_other_document_type_requires_a_name(self):
        response = self.upload(document_type='OTHER')
        self.assertEqual(response.status_code, 400)
        self.assertIn('other_document_name', response.data)

        response = self.upload(document_type='OTHER', other_document_name='Employee ID')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['other_document_name'], 'Employee ID')

    def test_rejects_unsupported_file_type(self):
        response = self.upload(filename='notes.txt', content_type='text/plain')
        self.assertEqual(response.status_code, 400)
        self.assertIn('file', response.data)

    def test_file_endpoint_streams_the_original_document_when_authenticated(self):
        upload = self.upload()
        file_url = f"{self.url}{upload.data['id']}/file/"
        response = self.client.get(file_url)
        self.assertEqual(response.status_code, 200)
        self.assertIn('inline', response['Content-Disposition'])
        self.assertIn('aadhaar.jpg', response['Content-Disposition'])

        download = self.client.get(f'{file_url}?download=1')
        self.assertIn('attachment', download['Content-Disposition'])

    def test_file_endpoint_requires_authentication(self):
        upload = self.upload()
        anonymous = APIClient()
        response = anonymous.get(f"{self.url}{upload.data['id']}/file/")
        self.assertEqual(response.status_code, 401)

    def test_file_endpoint_is_scoped_to_the_right_customer(self):
        upload = self.upload()
        other_customer = Customer.objects.create(customer_code='KYC002', full_name='Ravi',
                                                  primary_mobile='9876500012', role='BORROWER')
        response = self.client.get(f"/api/customers/{other_customer.pk}/kyc-documents/{upload.data['id']}/file/")
        self.assertEqual(response.status_code, 404)

    def test_accepts_webp_images(self):
        response = self.upload(filename='photo.webp', content_type='image/webp')
        self.assertEqual(response.status_code, 201, response.data)


@override_settings(MEDIA_ROOT=MEDIA_ROOT, KYC_PRIVATE_ROOT=MEDIA_ROOT + "-private")
class CustomerDocumentTypeTests(TestCase):
    """The 'Other' free-text name becomes a reusable dropdown entry, but only once a
    document using it has actually been saved â€” never from typing alone."""

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA_ROOT, ignore_errors=True)
        shutil.rmtree(MEDIA_ROOT + "-private", ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('doc-type-admin', is_staff=True))
        self.customer = Customer.objects.create(customer_code='KYC010', full_name='Sai',
                                                 primary_mobile='9876500020', role='BORROWER')
        self.kyc_url = f'/api/customers/{self.customer.pk}/kyc-documents/'
        self.types_url = '/api/customer-document-types/'

    def upload_other(self, name, filename='doc.jpg'):
        payload = {'document_type': 'OTHER', 'other_document_name': name,
                   'file': SimpleUploadedFile(filename, valid_document_bytes(filename), content_type='image/jpeg')}
        return self.client.post(self.kyc_url, payload, format='multipart')

    def test_types_list_starts_empty(self):
        response = self.client.get(self.types_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    def test_saving_an_other_document_registers_its_name_as_a_reusable_type(self):
        response = self.upload_other('Employee ID Card')
        self.assertEqual(response.status_code, 201, response.data)
        listing = self.client.get(self.types_url)
        self.assertEqual([row['name'] for row in listing.data], ['Employee ID Card'])

    def test_duplicate_names_are_merged_case_insensitively_and_trimmed(self):
        self.upload_other('Employee ID Card', filename='a.jpg')
        self.upload_other('  employee id card  ', filename='b.jpg')
        self.upload_other('EMPLOYEE ID CARD', filename='c.jpg')
        listing = self.client.get(self.types_url)
        self.assertEqual(len(listing.data), 1, listing.data)
        self.assertEqual(listing.data[0]['name'], 'Employee ID Card')
        # All three documents were still saved â€” only the reusable type is deduplicated.
        self.assertEqual(len(self.client.get(self.kyc_url).data), 3)

    def test_rejected_upload_does_not_register_a_type(self):
        response = self.client.post(self.kyc_url, {
            'document_type': 'OTHER', 'other_document_name': 'Half Finished Type',
            'file': SimpleUploadedFile('bad.txt', b'not-an-image', content_type='text/plain'),
        }, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get(self.types_url).data, [])

    def test_blank_other_name_is_rejected_and_registers_nothing(self):
        response = self.upload_other('   ')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get(self.types_url).data, [])

    def test_builtin_document_types_do_not_get_registered(self):
        self.client.post(self.kyc_url, {
            'document_type': 'AADHAAR',
            'file': SimpleUploadedFile('aadhaar.jpg', valid_document_bytes('aadhaar.jpg'), content_type='image/jpeg'),
        }, format='multipart')
        self.assertEqual(self.client.get(self.types_url).data, [])

    def test_types_endpoint_requires_authentication(self):
        anonymous = APIClient()
        response = anonymous.get(self.types_url)
        self.assertEqual(response.status_code, 401)
