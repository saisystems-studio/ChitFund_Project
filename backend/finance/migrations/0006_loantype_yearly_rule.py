from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("finance", "0005_loantype_allowed_installment_ids")]

    operations = [
        migrations.AddField(
            model_name="loantype",
            name="repeat_type",
            field=models.CharField(blank=True, db_column="RepeatType", default="", max_length=20),
        ),
        migrations.AddField(
            model_name="loantype",
            name="due_month",
            field=models.PositiveSmallIntegerField(blank=True, db_column="DueMonth", null=True),
        ),
        migrations.AddField(
            model_name="loantype",
            name="due_day",
            field=models.PositiveSmallIntegerField(blank=True, db_column="DueDay", null=True),
        ),
    ]
