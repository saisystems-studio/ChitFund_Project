import shutil
import tempfile
import uuid

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from customers.kyc_test_files import valid_document_bytes
from customers.models import Customer, CustomerDocumentType
from accounts.models import UserProfile
from .models import ChitGroup, ChitGroupInstallmentDetail, LoanInstallment, LoanType

MEDIA_ROOT = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=MEDIA_ROOT, KYC_PRIVATE_ROOT=MEDIA_ROOT + "-private")
class LoanKycDocumentTests(TestCase):
    """Loan Application KYC reuses the exact same document-type registry, file
    rules and upsert-on-success logic as Add Customer (Phase 8) â€” just scoped to
    a loan instead of a customer."""

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(MEDIA_ROOT, ignore_errors=True)
        shutil.rmtree(MEDIA_ROOT + "-private", ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('loan-kyc-admin', is_staff=True))
        self.customer = Customer.objects.create(customer_code='LKC001', full_name='Ravi',
                                                 primary_mobile='9876500030', role='BORROWER')
        self.other_customer = Customer.objects.create(customer_code='LKC002', full_name='Meena',
                                                       primary_mobile='9876500031', role='BORROWER')
        self.types = {name: LoanType.objects.get_or_create(name=name)[0] for name in ('Chit', 'Interest', 'Mortgage')}
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='LKC', name='Loan KYC Group', duration=2, duration_type='DAY')
        for number in (1, 2):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=number,
                                                     schedule_value=str(number), installment_amount=50)

    def make_loan(self, kind, customer=None):
        payload = {'customer_id': (customer or self.customer).pk, 'loan_type_id': self.types[kind].pk, 'amount': '100',
                   'start_date': timezone.localdate().isoformat(), 'interest_percentage': '10',
                   'periodicity': 'Daily', 'interest_duration': 2, 'chit_group_id': self.group.pk,
                   'include_sunday': True}
        response = self.client.post('/api/finance/loans/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def kyc_url(self, loan_id):
        return f'/api/finance/loans/{loan_id}/kyc-documents/'

    def upload(self, loan_id, filename='aadhaar.jpg', content_type='image/jpeg', **extra):
        payload = {'document_type': 'AADHAAR', 'file': SimpleUploadedFile(filename, valid_document_bytes(filename), content_type=content_type), **extra}
        return self.client.post(self.kyc_url(loan_id), payload, format='multipart')

    def test_chit_loan_document_upload(self):
        loan = self.make_loan('Chit')
        response = self.upload(loan['id'])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['document_type_display'], 'Aadhaar Card')

    def test_interest_loan_document_upload(self):
        loan = self.make_loan('Interest')
        response = self.upload(loan['id'])
        self.assertEqual(response.status_code, 201, response.data)

    def test_mortgage_loan_document_upload(self):
        loan = self.make_loan('Mortgage')
        response = self.upload(loan['id'])
        self.assertEqual(response.status_code, 201, response.data)

    def test_multiple_documents_for_the_same_loan(self):
        loan = self.make_loan('Chit')
        self.upload(loan['id'], filename='a.jpg', document_type='AADHAAR')
        self.upload(loan['id'], filename='b.pdf', content_type='application/pdf', document_type='PAN')
        listing = self.client.get(self.kyc_url(loan['id']))
        self.assertEqual(len(listing.data), 2)

    def test_documents_are_scoped_to_the_correct_loan_and_customer(self):
        loan_a = self.make_loan('Chit', customer=self.customer)
        loan_b = self.make_loan('Chit', customer=self.other_customer)
        self.upload(loan_a['id'], filename='a.jpg')
        # loan_b has no documents of its own, and loan_a's file isn't reachable via loan_b's id.
        self.assertEqual(len(self.client.get(self.kyc_url(loan_b['id'])).data), 0)
        doc_id = self.client.get(self.kyc_url(loan_a['id'])).data[0]['id']
        cross_loan = self.client.get(f"/api/finance/loans/{loan_b['id']}/kyc-documents/{doc_id}/file/")
        self.assertEqual(cross_loan.status_code, 404)

    def test_custom_other_type_is_shared_with_the_customer_registry(self):
        loan = self.make_loan('Chit')
        response = self.upload(loan['id'], document_type='OTHER', other_document_name='Property Tax Receipt')
        self.assertEqual(response.status_code, 201, response.data)
        names = list(CustomerDocumentType.objects.values_list('name', flat=True))
        self.assertEqual(names, ['Property Tax Receipt'])
        # The exact same registry is what Add Customer's dropdown reads from.
        listing = self.client.get('/api/customer-document-types/')
        self.assertEqual([row['name'] for row in listing.data], ['Property Tax Receipt'])

    def test_existing_customer_documents_remain_intact(self):
        """Attaching a loan document must never touch the customer's own KYC documents."""
        self.client.post(f'/api/customers/{self.customer.pk}/kyc-documents/', {
            'document_type': 'AADHAAR', 'file': SimpleUploadedFile('cust.jpg', valid_document_bytes('cust.jpg'), content_type='image/jpeg'),
        }, format='multipart')
        loan = self.make_loan('Chit')
        self.upload(loan['id'])
        customer_docs = self.client.get(f'/api/customers/{self.customer.pk}/kyc-documents/')
        self.assertEqual(len(customer_docs.data), 1)
        loan_docs = self.client.get(self.kyc_url(loan['id']))
        self.assertEqual(len(loan_docs.data), 1)

    def test_loan_creation_without_attachment_still_works(self):
        loan = self.make_loan('Chit')
        self.assertEqual(self.client.get(self.kyc_url(loan['id'])).data, [])

    def test_upload_retry_reuses_saved_document(self):
        loan = self.make_loan('Chit')
        token = str(uuid.uuid4())
        first = self.upload(loan['id'], upload_token=token)
        retry = self.upload(loan['id'], upload_token=token)
        self.assertEqual(first.data['id'], retry.data['id'])
        self.assertEqual(len(self.client.get(self.kyc_url(loan['id'])).data), 1)

    def test_view_only_user_cannot_access_loan_documents(self):
        loan = self.make_loan('Chit')
        uploaded = self.upload(loan['id'])
        user = User.objects.create_user('loan-view-only')
        UserProfile.objects.create(user=user, can_write=False)
        self.client.force_authenticate(user)
        root = self.kyc_url(loan['id'])
        self.assertEqual(self.client.get(root).status_code, 403)
        self.assertEqual(self.client.get(f"{root}{uploaded.data['id']}/file/").status_code, 403)

    def test_other_requires_a_name(self):
        loan = self.make_loan('Chit')
        response = self.upload(loan['id'], document_type='OTHER')
        self.assertEqual(response.status_code, 400)
        self.assertIn('other_document_name', response.data)

    def test_rejects_unsupported_file_type(self):
        loan = self.make_loan('Chit')
        response = self.upload(loan['id'], filename='notes.txt', content_type='text/plain')
        self.assertEqual(response.status_code, 400)

    def test_accepts_webp(self):
        loan = self.make_loan('Chit')
        response = self.upload(loan['id'], filename='photo.webp', content_type='image/webp')
        self.assertEqual(response.status_code, 201, response.data)

    def test_file_endpoint_requires_authentication(self):
        loan = self.make_loan('Chit')
        upload = self.upload(loan['id'])
        anonymous = APIClient()
        response = anonymous.get(f"{self.kyc_url(loan['id'])}{upload.data['id']}/file/")
        self.assertEqual(response.status_code, 401)

    def test_file_endpoint_streams_the_original_document(self):
        loan = self.make_loan('Chit')
        upload = self.upload(loan['id'])
        response = self.client.get(f"{self.kyc_url(loan['id'])}{upload.data['id']}/file/")
        self.assertEqual(response.status_code, 200)
        self.assertIn('aadhaar.jpg', response['Content-Disposition'])
