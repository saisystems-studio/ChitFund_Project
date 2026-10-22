from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import UserProfile
from .models import Group, Ledger


class LedgerGroupBindingTests(TestCase):
    """Add/Edit Ledger bind to Group Master by id, and Admin-only Edit/Delete is enforced by the API."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user('ledger-admin', is_staff=True)
        self.writer = User.objects.create_user('ledger-writer')
        UserProfile.objects.create(user=self.writer, can_write=True)
        self.root = Group.objects.filter(parent__isnull=True, name='Sundry Debtors').first() or Group.objects.create(name='Sundry Debtors', is_system=True)

    def test_new_group_is_listed_and_ledger_saves_its_id(self):
        self.client.force_authenticate(self.admin)
        created = self.client.post('/api/finance/groups/', {'group_name': 'Village Debtors', 'parent_group_id': self.root.pk}, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        listed = self.client.get('/api/finance/groups/').data
        self.assertIn(created.data['id'], [row['id'] for row in listed])
        ledger = self.client.post('/api/finance/ledgers/', {'name': 'Ravi', 'group_detail': created.data['id'], 'opening_balance': '0'}, format='json')
        self.assertEqual(ledger.status_code, 201, ledger.data)
        self.assertEqual((ledger.data['group_detail'], ledger.data['group_detail_name'], ledger.data['group']),
                         (created.data['id'], 'Village Debtors', 'Sundry Debtors'))
        fetched = self.client.get(f"/api/finance/ledgers/{ledger.data['id']}/").data
        self.assertEqual(fetched['group_detail'], created.data['id'])

    def test_group_used_by_a_ledger_cannot_be_deleted(self):
        self.client.force_authenticate(self.admin)
        child = Group.objects.create(name='Town Debtors', parent=self.root)
        ledger = Ledger.objects.create(name='Kumar', group='Sundry Debtors', group_detail=child)
        response = self.client.delete(f'/api/finance/groups/{child.pk}/')
        self.assertEqual((response.status_code, response.data['detail']), (409, 'This group cannot be deleted because it is used in 1 ledger.'))
        ledger.refresh_from_db()
        self.assertEqual(ledger.group_detail_id, child.pk)
        unused = Group.objects.create(name='Unused Debtors', parent=self.root)
        self.assertEqual(self.client.delete(f'/api/finance/groups/{unused.pk}/').status_code, 204)

    def test_edit_and_delete_are_admin_only(self):
        ledger = Ledger.objects.create(name='Selvi', group='Sundry Debtors', group_detail=self.root)
        self.client.force_authenticate(self.writer)
        self.assertEqual(self.client.patch(f'/api/finance/ledgers/{ledger.pk}/', {'name': 'Changed'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/finance/ledgers/{ledger.pk}/').status_code, 403)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch(f'/api/finance/ledgers/{ledger.pk}/', {'name': 'Selvi K'}, format='json').status_code, 200)
        self.assertEqual(self.client.delete(f'/api/finance/ledgers/{ledger.pk}/').status_code, 204)
        self.assertFalse(Ledger.objects.filter(pk=ledger.pk).exists())
