from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0010_mortgageunit_chitgroup_collection_date_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='chitgroup',
            name='end_date',
            field=models.DateField(blank=True, db_column='EndDate', null=True),
        ),
    ]
