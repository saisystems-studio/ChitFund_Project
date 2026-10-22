from decimal import Decimal
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("finance", "0041_ledger_one_per_customer")]
    operations = [
        migrations.AddField(model_name="collectiontransaction", name="advance_amount", field=models.DecimalField(max_digits=18, decimal_places=2, default=Decimal("0.00"), db_column="AdvanceAmount")),
        migrations.AddField(model_name="collectiontransaction", name="request_key", field=models.CharField(max_length=64, blank=True, default="", db_index=True, db_column="RequestKey")),
    ]
