"""Cash / Bank ledger resolution for Collection Entry and Payment Entry.

The Cash/Bank side of every receipt and payment is stored on the transaction's
`account` field; the accounting reports (Cash/Bank Ledger, Trial Balance, ...)
derive their postings from it. The form no longer asks for that ledger:

* Payment Mode "Cash"  -> the configured default Cash-in-Hand ledger.
* Any other mode       -> the Bank Accounts ledger the user selected.

A transaction is never saved without a valid Cash/Bank ledger.
"""
from django.conf import settings

from .models import Ledger

CASH_GROUP = "Cash-in-Hand"
BANK_GROUP = Ledger.BANK_GROUP


class LedgerMappingError(ValueError):
    """Raised with a field -> message mapping when no valid ledger can be resolved."""

    def __init__(self, field, message):
        super().__init__(message)
        self.field, self.message = field, message


def is_cash_mode(mode):
    return str(mode or "").strip().lower() == "cash"


def default_cash_ledger():
    """The explicitly configured Cash-in-Hand ledger, or the only one if there is exactly one.
    Never picks one of several ledgers on its own."""
    configured = str(getattr(settings, "CHITFUND_DEFAULT_CASH_LEDGER_ID", "") or "").strip()
    if configured:
        ledger = Ledger.objects.filter(pk=configured, group=CASH_GROUP).first() if configured.isdigit() else None
        if ledger is None:
            raise LedgerMappingError("account", "The configured default Cash in Hand ledger was not found. Check CHITFUND_DEFAULT_CASH_LEDGER_ID.")
        return ledger
    cash = list(Ledger.objects.filter(group=CASH_GROUP)[:2])
    if len(cash) == 1:
        return cash[0]
    if not cash:
        raise LedgerMappingError("account", "No Cash in Hand ledger exists. Create one in Ledger Master.")
    raise LedgerMappingError("account", "More than one Cash in Hand ledger exists. Configure the default one (CHITFUND_DEFAULT_CASH_LEDGER_ID).")


def resolve_account(payment_mode, account=None, current=None):
    """Return the Cash/Bank ledger a transaction must post to.

    `account` is the Ledger (or id) sent by the client, `current` the ledger already
    saved on the transaction being edited. For Cash, a record that already posts to a
    Cash-in-Hand ledger keeps it (no silent re-posting of history); otherwise the
    default Cash ledger is used. For every other mode a Bank Accounts ledger is required.
    """
    if account is not None and not isinstance(account, Ledger):
        text = str(account).strip()
        account = Ledger.objects.filter(pk=text).first() if text.isdigit() else None
        if account is None and text:
            raise LedgerMappingError("account", "Select a valid Bank Account.")
    if account is not None and account.group not in (CASH_GROUP, BANK_GROUP):
        raise LedgerMappingError("account", "Select a Cash or Bank account.")
    if is_cash_mode(payment_mode):
        # The Accounts dropdown offers Cash in Hand and Bank ledgers; Cash mode belongs
        # to a Cash in Hand account only.
        if account is not None:
            if account.group != CASH_GROUP:
                raise LedgerMappingError("account", "Payment Mode Cash needs a Cash in Hand account.")
            return account
        if current is not None and current.group == CASH_GROUP:
            return current
        return default_cash_ledger()
    chosen = account or (current if current is not None and current.group == BANK_GROUP else None)
    if chosen is None:
        raise LedgerMappingError("account", "Select a Bank Account.")
    if chosen.group != BANK_GROUP:
        raise LedgerMappingError("account", "Select a ledger from the Bank Accounts group.")
    return chosen


def is_account_ledger(ledger):
    """Cash in Hand / Bank Accounts ledgers belong on the Accounts side only."""
    return ledger is not None and ledger.group in (CASH_GROUP, BANK_GROUP)


def customer_ledger(customer):
    """The customer's own ledger (Sundry Debtors first) that a collection credits
    when no Ledger was chosen explicitly; None when the customer has none."""
    ledgers = [item for item in Ledger.objects.filter(customer=customer).order_by("id") if not is_account_ledger(item)]
    return next((item for item in ledgers if item.group == "Sundry Debtors"), ledgers[0] if ledgers else None)
