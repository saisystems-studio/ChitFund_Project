"""Read-only record details behind a report row's double-click "View More" page.

One endpoint resolves the exact selected record by its identifier and returns a plain
description of it. It only reads: no balance, schedule or posting is recalculated or
written here, so every figure is the one the report and the entry screens already show.

    GET /finance/reports/detail/?kind=loan&id=<loan id>
    GET /finance/reports/detail/?kind=voucher&ref=RV-000012   (RV / PV / PC / DUE / BT / JV,
                                                              or a loan number)
"""
import re
from datetime import timedelta
from decimal import Decimal

from rest_framework.decorators import api_view
from django.utils import timezone
from rest_framework.response import Response

from customers.kyc_security import CanAccessKycDocuments
from .models import (BankTransfer, CollectionAllocation, CollectionTransaction, CustomerLoanDetails, JournalLine, JournalVoucher,
                     PartyCollection, PartyDue, PaymentEntry)

ZERO = Decimal("0.00")
VOUCHER = re.compile(r"^(RV|PV|PC|DUE|BT|JV)-(\d+)$", re.IGNORECASE)


def _customer(customer):
    if customer is None:
        return None
    return {"id": customer.id, "code": customer.customer_code, "name": customer.full_name, "phone": customer.primary_mobile,
            "address": ", ".join(part for part in (customer.address, customer.city) if part)}


def _loan_brief(loan):
    return {"id": loan.id, "loan_no": loan.doc_no or loan.loan_no or "", "loan_type": loan.loan_type.name}


def _staff(item):
    staff = getattr(item, "done_by_staff", None)
    return getattr(staff, "staff_name", "") or ""


def _posting(ledger, debit=ZERO, credit=ZERO):
    return {"ledger": ledger.name if ledger else "—", "debit": debit, "credit": credit}


def _collection_voucher(item):
    allocations = [{
        "installment_number": a.installment.installment_number, "due_date": a.installment.due_date,
        "installment_amount": a.installment.installment_amount, "allocated": a.amount,
        "balance": a.installment.outstanding_amount, "status": a.installment.payment_status,
    } for a in CollectionAllocation.objects.filter(transaction=item).select_related("installment")]
    amount, ledger_amount = item.collection_amount or ZERO, item.ledger_amount or ZERO
    postings = [_posting(item.account, debit=amount)]
    if item.party_ledger_id or not item.ledger_id:
        postings.append(_posting(item.party_ledger, credit=amount - ledger_amount if item.party_ledger_id else amount))
    if item.ledger_id and ledger_amount:
        postings.append(_posting(item.ledger, credit=ledger_amount))
    return {
        "voucher_type": "Collection Entry (Receipt)", "voucher_no": f"RV-{item.pk:06d}", "date": item.collection_date,
        "amount": amount, "payment_mode": item.payment_mode, "reference": item.reference_no or item.cheque_number or item.upi_id,
        "narration": item.remarks, "account": item.account.name if item.account_id else "",
        "party": item.customer.full_name, "customer": _customer(item.customer), "loan": _loan_brief(item.loan),
        "extra": [("Installment", f"#{item.installment.installment_number}"), ("Advance Amount", item.advance_amount),
                  ("Adjustment", item.adjustment_amount), ("Discount", item.discount_amount), ("Bank", item.bank_name),
                  ("Cheque Date", item.cheque_date), ("Entered By", _staff(item))],
        "postings": postings, "allocations": allocations, "edit": {"kind": "collection", "id": item.pk},
    }


def _payment_voucher(item):
    return {
        "voucher_type": "Payment Entry", "voucher_no": f"PV-{item.pk:06d}", "date": item.date, "amount": item.amount,
        "payment_mode": item.payment_mode, "reference": item.transaction_utr or item.cheque_number or item.upi_id,
        "narration": item.notes, "account": item.account.name if item.account_id else "",
        "party": (item.ledger.name if item.ledger_id else item.ledger_group) or "", "customer": _customer(item.ledger.customer) if item.ledger_id else None,
        "loan": None, "extra": [("Ledger Group", item.ledger_group), ("Bank", item.bank_name), ("Entered By", _staff(item))],
        "postings": [_posting(item.ledger, debit=item.amount), _posting(item.account, credit=item.amount)],
        "allocations": [], "edit": {"kind": "payment", "id": item.pk},
    }


def _party_collection_voucher(item):
    allocations = [{"installment_number": None, "due_number": a.due.due_number, "due_date": a.due.due_date,
                    "installment_amount": a.due.amount, "allocated": a.amount, "from_advance": a.from_advance}
                   for a in item.allocations.select_related("due")]
    return {
        "voucher_type": "Party Collection", "voucher_no": item.voucher_no, "date": item.date, "amount": item.amount,
        "payment_mode": item.payment_mode, "reference": item.transaction_utr or item.cheque_number or item.upi_id,
        "narration": item.notes, "account": item.account.name, "party": item.party.name, "customer": _customer(item.party.customer),
        "loan": None, "extra": [("Bank", item.bank_name), ("Entered By", _staff(item))],
        "postings": [_posting(item.account, debit=item.amount), _posting(item.party, credit=item.amount)],
        "allocations": allocations, "edit": {"kind": "party", "id": item.pk},
    }


def _party_due_voucher(item):
    return {
        "voucher_type": "Party Due", "voucher_no": item.voucher_no, "date": item.due_date, "amount": item.amount,
        "payment_mode": "", "reference": item.due_number, "narration": item.notes, "account": item.counter_ledger.name,
        "party": item.party.name, "customer": _customer(item.party.customer), "loan": None,
        "extra": [("Due Number", item.due_number), ("Entered By", _staff(item))],
        "postings": [_posting(item.party, debit=item.amount), _posting(item.counter_ledger, credit=item.amount)],
        "allocations": [{"installment_number": None, "due_number": a.collection.voucher_no, "due_date": a.date,
                         "installment_amount": item.amount, "allocated": a.amount} for a in item.allocations.select_related("collection")],
        "edit": None,
    }


def _transfer_voucher(item):
    return {
        "voucher_type": item.get_transaction_type_display(), "voucher_no": item.voucher_no, "date": item.date, "amount": item.amount,
        "payment_mode": item.payment_mode, "reference": item.reference_no, "narration": item.notes,
        "account": f"{item.from_account.name} → {item.to_account.name}", "party": f"{item.from_account.name} → {item.to_account.name}",
        "customer": None, "loan": None, "extra": [],
        "postings": [_posting(item.to_account, debit=item.amount), _posting(item.from_account, credit=item.amount)],
        "allocations": [], "edit": {"kind": "transfer", "id": item.pk},
    }


def _journal_voucher(item):
    lines = item.lines.select_related("ledger")
    return {
        "voucher_type": "Journal Entry", "voucher_no": item.voucher_no, "date": item.date,
        "amount": sum((line.amount for line in lines if line.side == JournalLine.DEBIT), ZERO),
        "payment_mode": "", "reference": "", "narration": item.narration, "account": "", "party": "", "customer": None, "loan": None,
        "extra": [],
        "postings": [_posting(line.ledger, debit=line.amount if line.side == JournalLine.DEBIT else ZERO,
                              credit=line.amount if line.side == JournalLine.CREDIT else ZERO) for line in lines],
        "allocations": [], "edit": None,
    }


VOUCHER_BUILDERS = {
    "RV": (lambda pk: CollectionTransaction.objects.select_related("customer", "loan__loan_type", "installment", "account", "ledger", "party_ledger").filter(pk=pk).first(), _collection_voucher),
    "PV": (lambda pk: PaymentEntry.objects.select_related("ledger__customer", "account").filter(pk=pk).first(), _payment_voucher),
    "PC": (lambda pk: PartyCollection.objects.select_related("party__customer", "account").filter(pk=pk).first(), _party_collection_voucher),
    "DUE": (lambda pk: PartyDue.objects.select_related("party__customer", "counter_ledger").filter(pk=pk).first(), _party_due_voucher),
    "BT": (lambda pk: BankTransfer.objects.select_related("from_account", "to_account").filter(pk=pk).first(), _transfer_voucher),
    "JV": (lambda pk: JournalVoucher.objects.filter(pk=pk).first(), _journal_voucher),
}


def loan_detail(loan, highlight=None):
    installments = list(loan.installment_details.all())
    collections = loan.collection_transactions.select_related("account").order_by("collection_date", "id")
    interest, chit, mortgage = (getattr(loan, name, None) for name in ("interest_details", "chit_details", "mortgage_details"))
    extra = []
    if chit:
        extra.append(("Chit Group", chit.chit_group.name))
    if interest:
        extra += [("Interest %", interest.interest_percentage), ("Installments", interest.installment_count), ("Installment Amount", interest.installment_amount)]
    if mortgage:
        extra += [("Product", mortgage.product_name), ("Quantity", mortgage.quantity), ("Market Value", mortgage.market_value)]
    return {
        "kind": "loan", "customer": _customer(loan.customer), "highlight": highlight,
        "loan": {"id": loan.id, "loan_no": loan.doc_no or loan.loan_no or "", "loan_type": loan.loan_type.name, "status": loan.loan_status,
                 "application_date": loan.application_date, "start_date": loan.loan_start_date, "end_date": loan.loan_end_date,
                 "loan_amount": loan.loan_amount, "total_amount": loan.total_amount, "paid_amount": loan.paid_amount,
                 "penalty_amount": loan.penalty_amount, "outstanding_amount": loan.outstanding_amount, "extra": extra},
        "schedule": [{"id": row.id, "installment_number": row.installment_number, "due_date": row.due_date, "installment_amount": row.installment_amount,
                      "paid_amount": row.paid_amount, "penalty_amount": row.penalty_amount, "outstanding_amount": row.outstanding_amount,
                      "status": row.payment_status, "paid_date": row.paid_date} for row in installments],
        "collections": [{"id": c.id, "voucher_no": f"RV-{c.pk:06d}", "date": c.collection_date, "amount": c.collection_amount,
                         "payment_mode": c.payment_mode, "account": c.account.name if c.account_id else "", "reference": c.reference_no}
                        for c in collections],
        "edit": {"kind": "loan", "id": loan.id},
    }


def installment_detail(row):
    """One schedule due with the saved collections allocated to it (never a guessed split)."""
    from .views import _installment_receipts
    loan = row.loan
    receipts = _installment_receipts(row, timezone.localdate() + timedelta(days=36500))
    return {
        "kind": "installment", "customer": _customer(loan.customer), "loan": _loan_brief(loan),
        "due": {"installment_number": row.installment_number, "due_date": row.due_date, "amount": row.installment_amount, "penalty": row.penalty_amount,
                "paid": row.paid_amount, "outstanding": row.outstanding_amount, "status": row.payment_status, "paid_date": row.paid_date},
        "collections": [{"voucher_no": item["voucher_no"], "date": item["date"], "allocated": item["amount"], "receipt_amount": item["receipt_amount"],
                         "payment_mode": item["payment_mode"], "account": item["account"], "reference": item["reference_no"]} for item in receipts],
        "documents": None, "edit": None,
    }


def _loan_queryset():
    return CustomerLoanDetails.objects.select_related("customer", "loan_type")


DOCUMENT_KINDS = {"RV": "receipt", "PV": "payment"}


def _with_documents(request, payload, kind, record_id):
    """Attachments are read through the existing document endpoints; `allowed` mirrors who may open them."""
    payload["documents"] = {"kind": kind, "id": record_id, "allowed": CanAccessKycDocuments().has_permission(request, None)}
    return Response(payload)


@api_view(["GET"])
def report_detail(request):
    params = request.query_params
    kind = params.get("kind", "").strip().lower()
    ref = params.get("ref", "").strip()
    identifier = params.get("id", "").strip()
    if kind == "voucher" and ref:
        match = VOUCHER.match(ref)
        if match:
            prefix, number = match.group(1).upper(), int(match.group(2))
            find, build = VOUCHER_BUILDERS[prefix]
            item = find(number)
            if item is None:
                return Response({"detail": f"Voucher {ref.upper()} was not found. It may have been deleted."}, status=404)
            return _with_documents(request, {"kind": "voucher", **build(item)}, DOCUMENT_KINDS.get(prefix), item.pk) if prefix in DOCUMENT_KINDS else Response({"kind": "voucher", **build(item)})
        # Loan rows (Today Report, Customer-wise) are identified by their loan number.
        loan = _loan_queryset().filter(doc_no=ref).first() or _loan_queryset().filter(loan_no=ref).first()
        if loan is None:
            return Response({"detail": f"No record was found for {ref}."}, status=404)
        return _with_documents(request, loan_detail(loan), "loan", loan.pk)
    if kind == "installment" and identifier.isdigit():
        from django.db.models import Exists, OuterRef, Prefetch
        from .models import CustomerLoanInstallmentDetails
        row = (CustomerLoanInstallmentDetails.objects.select_related("loan__customer", "loan__loan_type").filter(pk=identifier)
               .prefetch_related(Prefetch("collection_allocations", queryset=CollectionAllocation.objects.select_related("transaction__account", "transaction__ledger")),
                                 Prefetch("collection_transactions", queryset=CollectionTransaction.objects.select_related("account", "ledger").annotate(
                                     has_allocations=Exists(CollectionAllocation.objects.filter(transaction_id=OuterRef("pk")))))).first())
        if row is None:
            return Response({"detail": "This due was not found. It may have been deleted."}, status=404)
        return Response(installment_detail(row))
    if kind == "loan" and identifier.isdigit():
        loan = _loan_queryset().filter(pk=identifier).first()
        if loan is None:
            return Response({"detail": "This loan was not found. It may have been deleted."}, status=404)
        highlight = params.get("installment", "").strip()
        return _with_documents(request, loan_detail(loan, int(highlight) if highlight.isdigit() else None), "loan", loan.pk)
    return Response({"detail": "Select a valid record."}, status=400)
