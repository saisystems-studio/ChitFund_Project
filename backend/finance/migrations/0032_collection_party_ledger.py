from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [('finance', '0031_ledger_bank_details')]
    operations = [migrations.AddField(model_name='collectiontransaction', name='party_ledger', field=models.ForeignKey(blank=True, null=True, db_column='PartyLedgerID', on_delete=django.db.models.deletion.PROTECT, related_name='party_collections', to='finance.ledger'))]
