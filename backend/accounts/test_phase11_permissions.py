from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient
from .models import UserProfile


class Phase11PermissionsTests(TestCase):
    def setUp(self):
        user = User.objects.create_user('phase11-entry')
        UserProfile.objects.create(user=user, can_write=True)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + Token.objects.create(user=user).key)

    def test_entry_user_cannot_regenerate_existing_schedule(self):
        for root in ('loans', 'customer-loans'):
            self.assertEqual(self.client.post(f'/api/finance/{root}/999999/generate-schedule/', {}, format='json').status_code, 403)

    def test_entry_user_cannot_mutate_records_or_manage_users(self):
        roots = ('/api/customers/', '/api/staff/', '/api/finance/loans/', '/api/finance/ledgers/',
                 '/api/finance/groups/', '/api/finance/payment-entries/', '/api/finance/collection-transactions/')
        for root in roots:
            for method in ('put', 'patch', 'delete'):
                with self.subTest(root=root, method=method):
                    self.assertEqual(getattr(self.client, method)(root + '999999/', {}, format='json').status_code, 403)
        from django.urls import reverse
        self.assertEqual(self.client.get(reverse('user-account-list')).status_code, 403)
