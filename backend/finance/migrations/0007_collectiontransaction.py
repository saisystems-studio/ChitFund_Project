from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("finance", "0006_loantype_yearly_rule")]

    operations = [migrations.CreateModel(
        name="CollectionTransaction",
        fields=[
            ("id", models.AutoField(db_column="CollectionTransactionID", primary_key=True, serialize=False)),
            ("created_by", models.CharField(blank=True, db_column="CreatedBy", max_length=100, null=True)),
            ("create_date", models.DateTimeField(auto_now_add=True, db_column="CreateDate", null=True)),
            ("modified_by", models.CharField(blank=True, db_column="ModifiedBy", max_length=100, null=True)),
            ("modified_date", models.DateTimeField(auto_now=True, db_column="ModifiedDate", null=True)),
            ("collection_amount", models.DecimalField(db_column="CollectionAmount", decimal_places=2, default=0, max_digits=18)),
            ("collection_date", models.DateField(db_column="CollectionDate")),
            ("payment_mode", models.CharField(db_column="PaymentMode", default="Cash", max_length=30)),
            ("reference_no", models.CharField(blank=True, db_column="ReferenceNo", default="", max_length=100)),
            ("remarks", models.CharField(blank=True, db_column="Remarks", default="", max_length=500)),
            ("customer", models.ForeignKey(db_column="CustomerID", on_delete=django.db.models.deletion.PROTECT, related_name="collection_transactions", to="customers.customer")),
            ("installment", models.ForeignKey(db_column="InstallmentID", on_delete=django.db.models.deletion.PROTECT, related_name="collection_transactions", to="finance.customerloaninstallmentdetails")),
            ("loan", models.ForeignKey(db_column="CustomerLoanID", on_delete=django.db.models.deletion.PROTECT, related_name="collection_transactions", to="finance.customerloandetails")),
        ],
        options={"db_table": "CollectionTransaction_tbl", "ordering": ("-collection_date", "-id")},
    )]
