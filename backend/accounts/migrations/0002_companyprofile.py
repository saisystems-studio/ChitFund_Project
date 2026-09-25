from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial")]

    operations = [
        migrations.CreateModel(
            name="CompanyProfile",
            fields=[
                ("id", models.PositiveSmallIntegerField(default=1, editable=False, primary_key=True, serialize=False)),
                ("company_name", models.CharField(blank=True, default="", max_length=200)),
                ("logo", models.TextField(blank=True, default="")),
            ],
        ),
    ]
