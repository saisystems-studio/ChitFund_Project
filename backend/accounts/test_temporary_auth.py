from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import SimpleTestCase, override_settings
from rest_framework.authentication import TokenAuthentication
from rest_framework.test import APIClient

from .temporary_auth import DevelopmentTokenAuthentication, issue_temporary_token


@override_settings(DEBUG=True, TEMP_ADMIN_LOGIN_ENABLED=True,
                   TEMP_ADMIN_USERNAME="development-user", TEMP_ADMIN_PASSWORD="test-password")
class TemporaryLoginTests(SimpleTestCase):
    # SimpleTestCase prohibits database queries, including accidental user creation.
    def setUp(self):
        self.client = APIClient()

    def login(self, username="development-user", password="test-password"):
        return self.client.post("/api/auth/login/", {"username": username, "password": password})

    def test_login_and_authenticated_me_without_database(self):
        with patch("accounts.views.authenticate") as normal_auth:
            response = self.login()
        normal_auth.assert_not_called()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.data), {"token", "user"})
        self.assertEqual(response.data["user"], {
            "id": None, "username": "development-user", "is_admin": True, "can_write": True})
        self.assertNotIn("test-password", str(response.data))
        self.client.credentials(HTTP_AUTHORIZATION="Token " + response.data["token"])
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data, response.data["user"])

    def test_wrong_credentials_use_existing_rejection(self):
        with patch("accounts.views.authenticate", return_value=None):
            for username, password in [("development-user", "wrong"), ("wrong", "test-password")]:
                with self.subTest(username=username):
                    response = self.login(username, password)
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.data, {"detail": "Invalid username or password."})

    def test_disabled_switch_rejects_login_and_existing_temporary_token(self):
        token = issue_temporary_token()
        with override_settings(TEMP_ADMIN_LOGIN_ENABLED=False), patch("accounts.views.authenticate", return_value=None):
            self.assertEqual(self.login().status_code, 401)
            self.client.credentials(HTTP_AUTHORIZATION="Token " + token)
            self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_debug_false_rejects_temporary_login(self):
        with override_settings(DEBUG=False), patch("accounts.views.authenticate", return_value=None):
            self.assertEqual(self.login().status_code, 401)

    def test_tampered_expired_and_rotated_tokens_rejected(self):
        token = issue_temporary_token()
        self.client.credentials(HTTP_AUTHORIZATION="Token " + token + "invalid")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION="Token " + token)
        with override_settings(TEMP_ADMIN_PASSWORD="replacement"):
            self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        with patch("django.core.signing.time.time", return_value=9999999999):
            self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_normal_login_preserved_with_switch_on_and_off(self):
        user = User(id=42, username="existing-user", is_active=True)
        profile = SimpleNamespace(can_write=False)
        token = SimpleNamespace(key="existing-token")
        for enabled in (True, False):
            with self.subTest(enabled=enabled), override_settings(TEMP_ADMIN_LOGIN_ENABLED=enabled):
                with patch("accounts.views.authenticate", return_value=user) as authenticate, \
                     patch("accounts.views.UserProfile.objects.get_or_create", return_value=(profile, False)), \
                     patch("accounts.views.Token.objects.get_or_create", return_value=(token, False)):
                    response = self.login("existing-user", "existing-password")
                authenticate.assert_called_once_with(username="existing-user", password="existing-password")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["token"], "existing-token")
                self.assertEqual(response.data["user"]["id"], 42)

    def test_normal_tokens_still_use_drf_authentication(self):
        expected = (object(), object())
        with patch.object(TokenAuthentication, "authenticate_credentials", return_value=expected) as normal:
            self.assertIs(DevelopmentTokenAuthentication().authenticate_credentials("normal-token"), expected)
        normal.assert_called_once_with("normal-token")
