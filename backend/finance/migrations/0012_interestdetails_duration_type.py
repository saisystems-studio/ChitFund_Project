from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("finance", "0011_chitgroup_end_date")]
    operations = [migrations.AddField(
        model_name="interestdetails", name="duration_type",
        field=models.CharField(blank=True, db_column="DurationType", default="", max_length=5),
    )]
