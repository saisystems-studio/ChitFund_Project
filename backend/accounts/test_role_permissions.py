from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from staff.models import Staff
from .models import UserProfile


class RolePermissionTests(TestCase):
    """Admin keeps full CRUD. A normal user's default profile (can_write=True,
    the new default for newly created accounts) gets Entry (Create) + View only —
    Edit and Delete must be rejected with 403 even though can_write is True."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user('role-admin', is_staff=True)
        self.normal = User.objects.create_user('role-normal')
        UserProfile.objects.create(user=self.normal, can_write=True)
        self.readonly = User.objects.create_user('role-readonly')
        UserProfile.objects.create(user=self.readonly, can_write=False)
        self.existing_writer = User.objects.create_user('legacy-writer')
        UserProfile.objects.create(user=self.existing_writer, can_write=True)

    def staff_payload(self, suffix='1'):
        return {'staff_name': f'Role Test Staff {suffix}', 'phone_number': '9876543210'}

    # --- Admin: full CRUD -------------------------------------------------
    def test_admin_create_works(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/staff/', self.staff_payload(), format='json')
        self.assertEqual(response.status_code, 201, response.data)

    def test_admin_view_works(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/staff/')
        self.assertEqual(response.status_code, 200)

    def test_admin_edit_works(self):
        staff = Staff.objects.create(staff_id='STF-ADM1', staff_name='Editable', phone_number='9876543210')
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f'/api/staff/{staff.id}/', {'staff_name': 'Edited By Admin'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)

    def test_admin_delete_works(self):
        staff = Staff.objects.create(staff_id='STF-ADM2', staff_name='Deletable', phone_number='9876543210')
        self.client.force_authenticate(self.admin)
        response = self.client.delete(f'/api/staff/{staff.id}/')
        self.assertIn(response.status_code, (200, 204))

    # --- Normal user (Entry + View default) -------------------------------
    def test_normal_user_create_works_where_allowed(self):
        self.client.force_authenticate(self.normal)
        response = self.client.post('/api/staff/', self.staff_payload('2'), format='json')
        self.assertEqual(response.status_code, 201, response.data)

    def test_normal_user_view_works(self):
        self.client.force_authenticate(self.normal)
        response = self.client.get('/api/staff/')
        self.assertEqual(response.status_code, 200)

    def test_normal_user_edit_fails_with_403(self):
        staff = Staff.objects.create(staff_id='STF-NRM1', staff_name='Protected', phone_number='9876543210')
        self.client.force_authenticate(self.normal)
        response = self.client.patch(f'/api/staff/{staff.id}/', {'staff_name': 'Hacked'}, format='json')
        self.assertEqual(response.status_code, 403, response.data)
        staff.refresh_from_db()
        self.assertEqual(staff.staff_name, 'Protected')

    def test_normal_user_delete_fails_with_403(self):
        staff = Staff.objects.create(staff_id='STF-NRM2', staff_name='Protected 2', phone_number='9876543210')
        self.client.force_authenticate(self.normal)
        response = self.client.delete(f'/api/staff/{staff.id}/')
        self.assertEqual(response.status_code, 403, response.data)
        self.assertTrue(Staff.objects.filter(pk=staff.pk).exists())

    # --- Pure view-only user (can_write explicitly False) ------------------
    def test_view_only_user_can_view_but_not_create(self):
        self.client.force_authenticate(self.readonly)
        get_response = self.client.get('/api/staff/')
        self.assertEqual(get_response.status_code, 200)
        post_response = self.client.post('/api/staff/', self.staff_payload('3'), format='json')
        self.assertEqual(post_response.status_code, 403, post_response.data)

    # --- A normal user who already had full write access before this phase ---
    def test_legacy_can_write_user_loses_edit_delete_but_keeps_entry_and_view(self):
        """Before this phase, any can_write=True user could also PUT/PATCH/DELETE.
        Enforcing role-based access intentionally narrows that for every non-admin
        going forward — Entry + View survive, Edit/Delete do not."""
        staff = Staff.objects.create(staff_id='STF-LGY1', staff_name='Legacy', phone_number='9876543210')
        self.client.force_authenticate(self.existing_writer)
        create_response = self.client.post('/api/staff/', self.staff_payload('4'), format='json')
        self.assertEqual(create_response.status_code, 201, create_response.data)
        edit_response = self.client.patch(f'/api/staff/{staff.id}/', {'staff_name': 'Still Legacy'}, format='json')
        self.assertEqual(edit_response.status_code, 403, edit_response.data)
        delete_response = self.client.delete(f'/api/staff/{staff.id}/')
        self.assertEqual(delete_response.status_code, 403, delete_response.data)

    # --- Direct, unauthorized API requests regardless of frontend ----------
    def test_direct_unauthorized_put_returns_403(self):
        staff = Staff.objects.create(staff_id='STF-DIR1', staff_name='Direct', phone_number='9876543210')
        self.client.force_authenticate(self.normal)
        response = self.client.put(f'/api/staff/{staff.id}/', {'staff_name': 'Direct Hack', 'phone_number': '9876543210'}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_existing_admin_access_remains_intact(self):
        """Nothing about this phase should touch is_staff/is_superuser accounts."""
        self.assertTrue(self.admin.is_staff)
        self.client.force_authenticate(self.admin)
        staff = Staff.objects.create(staff_id='STF-ADM3', staff_name='Still Admin', phone_number='9876543210')
        for method, kwargs in (
            ('get', {}),
            ('patch', {'data': {'staff_name': 'Still Admin Edited'}, 'format': 'json'}),
        ):
            response = getattr(self.client, method)(f'/api/staff/{staff.id}/', **kwargs)
            self.assertIn(response.status_code, (200,), f'{method} failed: {response.data}')


class NewUserDefaultPermissionTests(TestCase):
    """Admin-created accounts default to Entry + View (can_write=True) without the
    admin having to explicitly opt them in, and without touching any existing user."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user('user-mgmt-admin', is_staff=True)

    def test_new_user_created_by_admin_defaults_to_entry_and_view(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/auth/users/', {'username': 'brand-new-user', 'password': 'temp1234'}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        new_user = User.objects.get(username='brand-new-user')
        self.assertTrue(new_user.profile.can_write)

    def test_non_admin_cannot_manage_users(self):
        normal = User.objects.create_user('not-an-admin')
        self.client.force_authenticate(normal)
        response = self.client.post('/api/auth/users/', {'username': 'should-not-exist', 'password': 'temp1234'}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username='should-not-exist').exists())
