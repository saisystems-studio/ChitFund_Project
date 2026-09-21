from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("finance", "0003_seed_collection_types")]

    operations = [
        migrations.RunSQL(
            sql="""
            DECLARE @constraint nvarchar(200);
            SELECT @constraint = dc.name
            FROM sys.default_constraints dc
            INNER JOIN sys.columns c ON c.default_object_id = dc.object_id
            WHERE dc.parent_object_id = OBJECT_ID('dbo.ChitGroup_tbl')
              AND c.name = 'TotalAmount';
            IF @constraint IS NOT NULL
                EXEC(N'ALTER TABLE dbo.ChitGroup_tbl DROP CONSTRAINT [' + @constraint + N']');
            IF COL_LENGTH('dbo.ChitGroup_tbl', 'TotalAmount') IS NOT NULL
                ALTER TABLE dbo.ChitGroup_tbl DROP COLUMN TotalAmount;
            """,
            reverse_sql=migrations.RunSQL.noop,
        ),
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(
                    model_name="chitgroup",
                    name="total_amount",
                ),
            ],
            database_operations=[],
        ),
    ]
