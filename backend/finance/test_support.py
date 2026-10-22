"""Shared test fixtures."""
from .models import Ledger


def ensure_cash_ledger(name="Cash in Hand"):
    """Cash-mode entries post to the default Cash in Hand ledger, so fixtures that save
    Cash collections / payments need exactly one to exist."""
    return Ledger.objects.filter(group="Cash-in-Hand").first() or Ledger.objects.create(name=name, group="Cash-in-Hand")
