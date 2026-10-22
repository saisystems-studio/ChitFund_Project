from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('customers', '0007_private_kyc_storage')]
    operations = [migrations.AddField(model_name='customerkycdocument', name='upload_token',
                                     field=models.UUIDField(blank=True, null=True, unique=True))]
