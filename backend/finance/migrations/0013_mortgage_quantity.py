from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("finance", "0012_interestdetails_duration_type")]

    operations = [
        migrations.AddField(
            model_name="mortgage",
            name="quantity",
            field=models.DecimalField(
                max_digits=18, decimal_places=3, null=True, blank=True,
                db_column="Quantity",
            ),
        ),
    ]
