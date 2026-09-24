from decimal import Decimal
import django.db.models.deletion
from django.db import migrations, models


def seed_mortgage_type(apps, schema_editor):
    LoanType = apps.get_model("finance", "LoanType")
    item = LoanType.objects.filter(name__iexact="Mortgage").order_by("id").first()
    if item:
        item.name = "Mortgage"
        item.is_active = True
        item.save(update_fields=("name", "is_active"))
    else:
        LoanType.objects.create(name="Mortgage", is_active=True)


class Migration(migrations.Migration):

    dependencies = [
        ("finance", "0008_adjustmenttypemaster_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="Mortgage",
            fields=[
                ("created_by", models.CharField(blank=True, db_column="CreatedBy", max_length=100, null=True)),
                ("create_date", models.DateTimeField(auto_now_add=True, db_column="CreateDate", null=True)),
                ("modified_by", models.CharField(blank=True, db_column="ModifiedBy", max_length=100, null=True)),
                ("modified_date", models.DateTimeField(auto_now=True, db_column="ModifiedDate", null=True)),
                ("id", models.AutoField(db_column="ID", primary_key=True, serialize=False)),
                ("product_name", models.CharField(db_column="ProductName", max_length=150, unique=True)),
                ("unit", models.CharField(db_column="Unit", max_length=50)),
                ("current_rate", models.DecimalField(db_column="CurrentRate", decimal_places=2, default=Decimal("0.00"), max_digits=18)),
                ("is_active", models.BooleanField(db_column="IsActive", default=True)),
            ],
            options={
                "db_table": "Mortgage_tbl",
                "ordering": ("product_name",),
            },
        ),
        migrations.CreateModel(
            name="MortgageLoanDetails",
            fields=[
                ("created_by", models.CharField(blank=True, db_column="CreatedBy", max_length=100, null=True)),
                ("create_date", models.DateTimeField(auto_now_add=True, db_column="CreateDate", null=True)),
                ("modified_by", models.CharField(blank=True, db_column="ModifiedBy", max_length=100, null=True)),
                ("modified_date", models.DateTimeField(auto_now=True, db_column="ModifiedDate", null=True)),
                ("id", models.AutoField(db_column="ID", primary_key=True, serialize=False)),
                ("product_name", models.CharField(db_column="ProductName", max_length=150)),
                ("unit", models.CharField(db_column="Unit", max_length=50)),
                ("quantity", models.DecimalField(db_column="Quantity", decimal_places=3, default=Decimal("0.000"), max_digits=18)),
                ("current_rate", models.DecimalField(db_column="CurrentRate", decimal_places=2, default=Decimal("0.00"), max_digits=18)),
                ("market_value", models.DecimalField(db_column="MarketValue", decimal_places=2, default=Decimal("0.00"), max_digits=18)),
                ("loan_amount", models.DecimalField(db_column="LoanAmount", decimal_places=2, default=Decimal("0.00"), max_digits=18)),
                ("interest_percentage", models.DecimalField(db_column="InterestPercentage", decimal_places=3, default=0, max_digits=8)),
                ("daily_interest_amount", models.DecimalField(db_column="DailyInterestAmount", decimal_places=2, default=Decimal("0.00"), max_digits=18)),
                ("loan", models.OneToOneField(db_column="CustomerLoanDetailsID", on_delete=django.db.models.deletion.CASCADE, related_name="mortgage_details", to="finance.customerloandetails")),
                ("product", models.ForeignKey(db_column="MortgageID", on_delete=django.db.models.deletion.PROTECT, to="finance.mortgage")),
            ],
            options={
                "db_table": "MortgageLoanDetails_tbl",
            },
        ),
        migrations.RunPython(seed_mortgage_type, migrations.RunPython.noop),
    ]
