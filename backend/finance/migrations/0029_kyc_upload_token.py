from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('finance', '0028_private_kyc_storage')]
    operations = [migrations.AddField(model_name='loankycdocument', name='upload_token',
                                     field=models.UUIDField(blank=True, null=True, unique=True))]
