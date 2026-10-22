from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import CustomerKycDocument
from finance.models import LoanKycDocument, TransactionDocument
from staff.models import StaffKycDocument


@receiver(post_delete, sender=StaffKycDocument)
@receiver(post_delete, sender=CustomerKycDocument)
@receiver(post_delete, sender=LoanKycDocument)
@receiver(post_delete, sender=TransactionDocument)
def remove_private_kyc_file(sender, instance, **kwargs):
    if instance.file.name:
        storage, name = instance.file.storage, instance.file.name
        # A rollback must retain the file. Only newly stored private files are removed.
        transaction.on_commit(lambda: storage.delete(name))
