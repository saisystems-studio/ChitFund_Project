from django.db import migrations


# The project standardizes on "Cash-in-Hand" (hyphenated) as the canonical
# name for this root group/ledger classification everywhere -- Group_tbl's
# root row, Ledger.group, PaymentEntry.ACCOUNT_GROUPS and the frontend all
# use this spelling. Earlier revisions of this code briefly used "Cash in
# Hand" (spaces) in some of those places, which could have left a root
# Group row or existing Ledger rows saved with the old spelling. Rename
# both in place so existing data keeps matching and nothing silently drops
# out of the Collection/Payment Entry Accounts dropdown.
def fix_name(apps, schema_editor):
    Group = apps.get_model("finance", "Group")
    Ledger = apps.get_model("finance", "Ledger")
    Group.objects.filter(parent__isnull=True, name="Cash in Hand").update(name="Cash-in-Hand")
    Ledger.objects.filter(group="Cash in Hand").update(group="Cash-in-Hand")


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("finance", "0021_chitgroup_done_by_staff_group_done_by_staff_and_more"),
    ]

    operations = [
        migrations.RunPython(fix_name, noop),
    ]
