from django.db.models.signals import post_save
from django.dispatch import receiver

from customers.models import Customer
from .models import Ledger

GROUP_BY_ROLE = {"BORROWER": "Sundry Debtors", "LENDER": "Sundry Creditors"}


@receiver(post_save, sender=Customer)
def sync_customer_ledger(sender, instance, **kwargs):
    """Keep a Ledger row in sync per Sundry Debtor/Creditor role, so customer
    names show up in the Ledger Name lists without any manual entry."""
    groups_needed = [group for role, group in GROUP_BY_ROLE.items() if instance.role in (role, "BOTH")]
    existing = {ledger.group: ledger for ledger in Ledger.objects.filter(customer=instance)}
    for group in groups_needed:
        ledger = existing.get(group)
        if ledger:
            if ledger.name != instance.full_name:
                ledger.name = instance.full_name
                ledger.save(update_fields=["name"])
        else:
            Ledger.objects.create(customer=instance, name=instance.full_name, group=group, group_detail=instance.group)
