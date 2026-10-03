from django.db import migrations

# Mirrors finance.management.commands.seed.ROOT_GROUPS -- kept in sync by
# hand since migrations must not import application code that can change
# shape later. Backfills `nature` on already-seeded roots and creates the
# two Income roots that never existed before (no root group previously
# represented Income, even though Ledger/CollectionTransaction/PaymentEntry
# all accept "Income" as a flat ledger-group choice).
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


def seed_nature(apps, schema_editor):
    Group = apps.get_model("finance", "Group")
    for name, nature in ROOT_GROUPS:
        group, created = Group.objects.get_or_create(
            parent=None, name=name,
            defaults={"is_system": True, "is_active": True, "nature": nature},
        )
        if not created and group.nature != nature:
            group.nature = nature
            group.save(update_fields=["nature"])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("finance", "0025_group_nature"),
    ]

    operations = [
        migrations.RunPython(seed_nature, noop),
    ]
