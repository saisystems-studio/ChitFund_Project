from django.core.management.base import BaseCommand

from finance.models import Group

# The only initial-data source for Group_tbl root groups; never hardcoded
# in the frontend. Run with: python manage.py seed
# Each entry is (name, nature) -- nature drives Trial Balance / Balance
# Sheet / P&L classification (see Group.NATURE_CHOICES); never inferred
# from the name at report time, only set here at seed/data-migration time.
ROOT_GROUPS = (
    ("Bank Accounts", "ASSET"),
    ("Cash-in-Hand", "ASSET"),
    ("Current Assets", "ASSET"),
    ("Fixed Assets", "ASSET"),
    ("Investments", "ASSET"),
    ("Loans & Advances (Asset)", "ASSET"),
    ("Deposits (Asset)", "ASSET"),
    ("Misc. Expenses (ASSET)", "ASSET"),
    ("Direct Expenses", "EXPENSE"),
    ("Indirect Expenses", "EXPENSE"),
    ("Direct Income", "INCOME"),
    ("Indirect Income", "INCOME"),
    ("Sundry Debtors", "ASSET"),
    ("Sundry Creditors", "LIABILITY"),
    ("Current Liabilities", "LIABILITY"),
    ("Loans (Liability)", "LIABILITY"),
)


class Command(BaseCommand):
    help = "Seed the initial root Groups into Group_tbl. Safe to run multiple times (get_or_create, no duplicates)."

    def handle(self, *args, **options):
        created_count = 0
        for name, nature in ROOT_GROUPS:
            # IDs are always database-generated; only (parent=None, name) is
            # used to detect an existing row, so re-running never duplicates.
            group, created = Group.objects.get_or_create(
                parent=None, name=name,
                defaults={"is_system": True, "is_active": True, "nature": nature},
            )
            if not created and group.nature != nature:
                group.nature = nature
                group.save(update_fields=["nature"])
            created_count += int(created)
            self.stdout.write(f"{'Created' if created else 'Exists '} [{group.id}] {group.name}")
        self.stdout.write(self.style.SUCCESS(
            f"Seed complete: {created_count} new root group(s) created, {len(ROOT_GROUPS)} total checked."
        ))
