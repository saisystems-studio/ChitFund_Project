"""Isolated QA backend for qa/party-ledger: a SQLite file, never the SQL Server database.
Copy next to the QA run (or put this folder on PYTHONPATH) and set QA_DB to a scratch path."""
import os

from config.settings import *  # noqa: F401,F403

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": os.environ.get("QA_DB", "qa.sqlite3")}}
# One historic migration is SQL Server specific: build the schema from the models instead,
# then run `manage.py seed` for the root groups.
MIGRATION_MODULES = {"accounts": None, "customers": None, "finance": None, "staff": None, "authtoken": None}
ALLOWED_HOSTS = ["*"]
TEMP_ADMIN_LOGIN_ENABLED = False
CORS_ALLOW_ALL_ORIGINS = True
