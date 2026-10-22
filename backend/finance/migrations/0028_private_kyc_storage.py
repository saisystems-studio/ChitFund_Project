from django.db import migrations, models
import finance.models
import customers.kyc_security


class Migration(migrations.Migration):
    dependencies = [('finance', '0027_loankycdocument'), ('customers', '0007_private_kyc_storage')]
    operations = [migrations.SeparateDatabaseAndState(state_operations=[
        migrations.AlterField(model_name='loankycdocument', name='file',
            field=models.FileField(db_column='File', upload_to=finance.models.loan_kyc_document_upload_path,
                                   storage=customers.kyc_security.private_kyc_storage)),
    ])]
