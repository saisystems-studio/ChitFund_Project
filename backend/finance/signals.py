from django.db.models.signals import post_save
from django.dispatch import receiver

from customers.models import Customer
from .models import Ledger

GROUP_BY_ROLE = {"BORROWER": "Sundry Debtors", "LENDER": "Sundry Creditors"}


def linked_party_ledger(customer):
    """The customer's one party ledger (Customer ID <-> Ledger ID), or None."""
    return Ledger.objects.filter(customer=customer).exclude(group__in=(Ledger.CASH_GROUP, Ledger.BANK_GROUP)).order_by("id").first()


@receiver(post_save, sender=Customer)
def sync_customer_ledger(sender, instance, **kwargs):
    """Customer Name = Party Ledger Name: every customer has exactly one linked party
    ledger. Saving a customer creates it once (Opening Balance zero) and afterwards only
    keeps its name and group in step -- it never creates a second ledger, matched by the
    Customer ID link, never by name."""
    root = instance.group.root().name if instance.group_id else GROUP_BY_ROLE.get(instance.role)
    ledger = linked_party_ledger(instance)
    if ledger is None:
        if root:
            Ledger.objects.create(customer=instance, name=instance.full_name, group=root, group_detail=instance.group)
        return
    changed = []
    if ledger.name != instance.full_name:
        ledger.name = instance.full_name
        changed.append("name")
    if instance.group_id and ledger.group_detail_id != instance.group_id:
        ledger.group_detail, ledger.group = instance.group, root
        changed += ["group_detail", "group"]
        if root != Ledger.DEBTORS_GROUP and ledger.collection_type:
            ledger.collection_type = ""
            changed.append("collection_type")
    if changed:
        ledger.save(update_fields=changed)
