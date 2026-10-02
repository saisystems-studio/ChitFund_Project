from django.core.management.base import BaseCommand

from finance.models import Group

# The only initial-data source for Group_tbl root groups; never hardcoded
# in the frontend. Run with: python manage.py seed
ROOT_GROUPS = (
    "Bank Accounts",
    "Cash-in-Hand",
    "Current Assets",
    "Fixed Assets",
    "Investments",
    "Loans & Advances (Asset)",
    "Deposits (Asset)",
    "Misc. Expenses (ASSET)",
    "Direct Expenses",
    "Indirect Expenses",
    "Sundry Debtors",
    "Sundry Creditors",
    "Current Liabilities",
    "Loans (Liability)",
)


class Command(BaseCommand):
    help = "Seed the initial root Groups into Group_tbl. Safe to run multiple times (get_or_create, no duplicates)."

    def handle(self, *args, **options):
        created_count = 0
        for name in ROOT_GROUPS:
            # IDs are always database-generated; only (parent=None, name) is
            # used to detect an existing row, so re-running never duplicates.
            group, created = Group.objects.get_or_create(
                parent=None, name=name,
                defaults={"is_system": True, "is_active": True},
            )
            created_count += int(created)
            self.stdout.write(f"{'Created' if created else 'Exists '} [{group.id}] {group.name}")
        self.stdout.write(self.style.SUCCESS(
            f"Seed complete: {created_count} new root group(s) created, {len(ROOT_GROUPS)} total checked."
        ))
