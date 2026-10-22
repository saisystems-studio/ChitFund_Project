from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone

class Migration(migrations.Migration):
    dependencies = [('finance', '0033_mortgage_hsn_tax_uqc')]
    operations = [migrations.CreateModel(name='BankTransfer', fields=[
        ('id',models.BigAutoField(auto_created=True,primary_key=True,serialize=False,verbose_name='ID')),
        ('created_by',models.CharField(blank=True,db_column='CreatedBy',max_length=100,null=True)),
        ('create_date',models.DateTimeField(auto_now_add=True,db_column='CreateDate',null=True)),
        ('modified_by',models.CharField(blank=True,db_column='ModifiedBy',max_length=100,null=True)),
        ('modified_date',models.DateTimeField(auto_now=True,db_column='ModifiedDate',null=True)),
        ('transaction_type',models.CharField(choices=[('DEPOSIT','Deposit'),('WITHDRAWAL','Withdrawal')],max_length=10)),
        ('date',models.DateField(default=django.utils.timezone.localdate)),
        ('amount',models.DecimalField(decimal_places=2,max_digits=18)),
        ('reference_no',models.CharField(blank=True,default='',max_length=100)),
        ('notes',models.CharField(blank=True,default='',max_length=500)),
        ('from_account',models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,related_name='bank_transfers_out',to='finance.ledger')),
        ('to_account',models.ForeignKey(on_delete=django.db.models.deletion.PROTECT,related_name='bank_transfers_in',to='finance.ledger')),
    ], options={'ordering':('-date','-id'),'constraints':[
        models.CheckConstraint(condition=models.Q(amount__gt=0),name='bank_transfer_positive_amount'),
        models.CheckConstraint(condition=~models.Q(from_account=models.F('to_account')),name='bank_transfer_distinct_accounts')]} )]
