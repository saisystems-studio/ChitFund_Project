from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("finance", "0032_collection_party_ledger")]

    operations = [
        migrations.AddField(
            model_name="mortgage",
            name="hsn_code",
            field=models.CharField(blank=True, db_column="HSNCode", default="", max_length=30),
        ),
        migrations.AddField(
            model_name="mortgage",
            name="rate_of_tax",
            field=models.PositiveSmallIntegerField(
                choices=[(0, "0%"), (5, "5%"), (12, "12%"), (18, "18%"), (28, "28%")],
                db_column="RateOfTax",
                default=0,
            ),
        ),
        migrations.AddField(
            model_name="mortgage",
            name="uqc",
            field=models.CharField(blank=True, db_column="UQC", default="", max_length=20),
        ),
        migrations.CreateModel(
            name="MortgageUqc",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=20, unique=True)),
            ],
            options={
                "db_table": "MortgageUQC_tbl",
                "ordering": ("name",),
            },
        ),
    ]
