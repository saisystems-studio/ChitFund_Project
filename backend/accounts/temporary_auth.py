"""Temporary development authentication; never persists a user or token."""

import secrets

from django.conf import settings
from django.contrib.auth.models import User
from django.core import signing
from django.utils.crypto import constant_time_compare, salted_hmac
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed


TOKEN_PREFIX = "temp-dev."
# Development tokens intentionally expire on backend restart (single-process dev server).
_PROCESS_KEY = secrets.token_urlsafe(48)


def temporary_login_enabled():
    return bool(settings.DEBUG and settings.TEMP_ADMIN_LOGIN_ENABLED
                and settings.TEMP_ADMIN_USERNAME and settings.TEMP_ADMIN_PASSWORD)


def temporary_credentials_match(username, password):
    return (temporary_login_enabled()
            and constant_time_compare(username, settings.TEMP_ADMIN_USERNAME)
            and constant_time_compare(password, settings.TEMP_ADMIN_PASSWORD))


def temporary_user():
    user = User(username=settings.TEMP_ADMIN_USERNAME, is_active=True,
                is_staff=True, is_superuser=True)
    user.is_temporary_admin = True
    return user


def temporary_user_data():
    return {"id": None, "username": settings.TEMP_ADMIN_USERNAME,
            "is_admin": True, "can_write": True}


def _signer():
    # Credential changes also invalidate issued tokens. No credentials enter the payload.
    key = salted_hmac("accounts.temporary.credentials",
                      repr((settings.TEMP_ADMIN_USERNAME, settings.TEMP_ADMIN_PASSWORD)),
                      secret=_PROCESS_KEY, algorithm="sha256").hexdigest()
    return signing.TimestampSigner(key=key, salt="accounts.temporary.login", fallback_keys=[])


def issue_temporary_token():
    return TOKEN_PREFIX + _signer().sign(secrets.token_urlsafe(32))


class DevelopmentTokenAuthentication(TokenAuthentication):
    """Recognize development tokens; delegate all normal tokens to DRF unchanged."""

    def authenticate_credentials(self, key):
        if not key.startswith(TOKEN_PREFIX):
            return super().authenticate_credentials(key)
        if not temporary_login_enabled():
            raise AuthenticationFailed("Invalid token.")
        try:
            _signer().unsign(key[len(TOKEN_PREFIX):], max_age=8 * 60 * 60)
        except signing.BadSignature:
            raise AuthenticationFailed("Invalid token.")
        return temporary_user(), key
