from django.db import migrations, models
import customers.models
import customers.kyc_security


class Migration(migrations.Migration):
    dependencies = [('customers', '0006_customerdocumenttype')]
    operations = [migrations.SeparateDatabaseAndState(state_operations=[
        migrations.AlterField(model_name='customerkycdocument', name='file',
            field=models.FileField(db_column='File', upload_to=customers.models.kyc_document_upload_path,
                                   storage=customers.kyc_security.private_kyc_storage)),
    ])]
