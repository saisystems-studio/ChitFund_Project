"""Isolated KYC tests: never connect to the configured SQL Server database."""
from .settings import *  # noqa: F403

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
MIGRATION_MODULES = {"accounts": None, "customers": None, "finance": None, "staff": None}
TEMP_ADMIN_LOGIN_ENABLED = False


