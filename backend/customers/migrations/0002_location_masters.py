from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("customers", "0001_initial")]

    operations = [
        migrations.CreateModel(
            name="CountryMaster",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(db_index=True, max_length=120, unique=True)),
            ],
            options={"db_table": "CountryMaster", "ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="StateMaster",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(db_index=True, max_length=120)),
                ("country", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="states", to="customers.countrymaster")),
            ],
            options={"db_table": "StateMaster", "ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="DistrictMaster",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(db_index=True, max_length=120)),
                ("pincode", models.CharField(blank=True, max_length=10, null=True)),
                ("state", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="districts", to="customers.statemaster")),
            ],
            options={"db_table": "DistrictMaster", "ordering": ["name"]},
        ),
        migrations.AddConstraint(model_name="statemaster", constraint=models.UniqueConstraint(fields=("name", "country"), name="uniq_state_country")),
        migrations.AddConstraint(model_name="districtmaster", constraint=models.UniqueConstraint(fields=("name", "state"), name="uniq_district_state")),
    ]
