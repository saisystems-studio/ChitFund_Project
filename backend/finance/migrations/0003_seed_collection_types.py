from django.db import migrations


def seed_collection_types(apps, schema_editor):
    LoanInstallment = apps.get_model("finance", "LoanInstallment")
    defaults = (
        ("Daily", "DAILY"),
        ("Weekly", "WEEKLY"),
        ("Monthly", "MONTHLY"),
        ("Annual", "ANNUAL"),
        ("100 Days", "100DAYS"),
        ("Other", "OTHER"),
    )
    for name, code in defaults:
        LoanInstallment.objects.update_or_create(
            name=name,
            defaults={"code": code, "is_active": True},
        )


class Migration(migrations.Migration):
    dependencies = [
        ("finance", "0002_chitgroup_total_amount"),
    ]

    operations = [
        migrations.RunPython(seed_collection_types, migrations.RunPython.noop),
    ]
