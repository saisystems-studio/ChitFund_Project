from django.db import migrations, models


def seed_allowed(apps, schema_editor):
    LoanType = apps.get_model("finance", "LoanType")
    LoanInstallment = apps.get_model("finance", "LoanInstallment")
    for name, code in (("Quarterly", "QUARTERLY"), ("Half-Yearly", "HALF_YEARLY")):
        LoanInstallment.objects.update_or_create(name=name, defaults={"code": code, "is_active": True})
    ids = {row.name: row.id for row in LoanInstallment.objects.all()}
    defaults = {
        "Chit": [ids[name] for name in ("Daily", "Weekly", "Monthly") if name in ids],
        "Interest": [ids[name] for name in ("Daily", "Weekly", "Monthly", "Annual") if name in ids],
    }
    for name, allowed in defaults.items():
        LoanType.objects.filter(name=name).update(allowed_installment_ids=str(allowed).replace(" ", ""))


class Migration(migrations.Migration):
    dependencies = [("finance", "0004_remove_chitgroup_total_amount")]
    operations = [
        migrations.AddField(
            model_name="loantype", name="allowed_installment_ids",
            field=models.TextField(db_column="AllowedInstallmentIDs", default="[]"),
        ),
        migrations.RunPython(seed_allowed, migrations.RunPython.noop),
    ]
