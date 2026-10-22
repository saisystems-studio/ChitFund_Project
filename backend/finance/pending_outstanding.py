"""Pending & Outstanding report (Accounts Reports), read-only.

    GET /finance/reports/pending-outstanding/parties/
    GET /finance/reports/pending-outstanding/?view=multiple|individual&basis=voucher|due
        &parties=<ledger ids, comma separated; blank = all>&from=&to=&date=&sort=overdue|party

A party is its linked Party Ledger (Customer Master <-> Ledger Master), so a party is never listed
twice. Nothing here posts or recalculates anything; figures come from the stored schedules,
collection allocations and ledger postings the other reports already use.

multiple  - due-wise: one row per loan installment / party due that still has a pending balance as
            of the report date, with Paid taken only from the saved allocations (views._pending_as_of
            / PartyAllocation). Others (Advance) is never netted against a due; it is reported
            separately as Unallocated Advance.
individual - party ledger statement (DR / CR) with Opening + running balance. Opening includes every
            posting before the selected period, so the closing balance reconciles with the full ledger.

Date handling: in the due-wise view a loan installment's Voucher Date is its loan's application date and
its Due Date the schedule date; a party due has one date (its Due Date), used for both. In the ledger view
every due posts on its due date (as in the Customer-wise report and the ledger statements), so the running
balance stays chronological. Postings without a due date (receipts, journals, payments) are reported on
their voucher date under either basis. Installments are only
posted once due (due date on or before the cutoff = `to`/`date`, else today), like the Customer-wise report.
"""
from datetime import date
from decimal import Decimal

from django.db.models import Exists, OuterRef, Prefetch, Q
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .cash_bank import is_account_ledger
from .models import (CollectionAllocation, CollectionTransaction, CustomerLoanInstallmentDetails, JournalLine, Ledger, PartyCollection,
                     PartyDue, PaymentEntry)
from .views import _pending_as_of

ZERO = Decimal("0.00")


def _parse_date(value):
    if not value:
        return None
    return date.fromisoformat(str(value)[:10])


def _party_queryset():
    return (Ledger.objects.filter(Q(customer__isnull=False) | Q(party_dues__isnull=False) | Q(party_receipts__isnull=False))
            .select_related("customer").distinct().order_by("name", "id"))


def _eligible(queryset):
    return [item for item in queryset if not is_account_ledger(item)]


def _party_payload(ledger):
    customer = ledger.customer
    return {"id": ledger.id, "name": ledger.name, "code": customer.customer_code if customer else "", "phone": customer.primary_mobile if customer else ""}


@api_view(["GET"])
def pending_outstanding_parties(request):
    return Response([_party_payload(item) for item in _eligible(_party_queryset())])


def _signed(value):
    value = value.quantize(Decimal("0.01"))
    return abs(value), "CR" if value < 0 else "DR"


def _selected(params):
    ids = [part for part in str(params.get("parties", "")).split(",") if part.strip().isdigit()]
    parties = _eligible(_party_queryset().filter(pk__in=ids) if ids else _party_queryset())
    return parties


def _due_rows(parties, as_of):
    """Pending dues as of `as_of` (installments and party dues), with their saved paid amounts."""
    by_customer = {item.customer_id: item for item in parties if item.customer_id}
    by_id = {item.id: item for item in parties}
    rows = []
    installments = (CustomerLoanInstallmentDetails.objects.filter(loan__customer_id__in=list(by_customer), due_date__lte=as_of)
                    .select_related("loan__customer", "loan__loan_type")
                    .prefetch_related(Prefetch("collection_allocations", queryset=CollectionAllocation.objects.select_related("transaction")),
                                      Prefetch("collection_transactions", queryset=CollectionTransaction.objects.annotate(
                                          has_allocations=Exists(CollectionAllocation.objects.filter(transaction_id=OuterRef("pk")))))))
    for row in installments:
        due, paid, pending = _pending_as_of(row, as_of)
        if pending <= 0:
            continue
        loan, party = row.loan, by_customer[row.loan.customer_id]
        rows.append({"kind": "installment", "record_id": row.id, "party_id": party.id, "party_name": party.name, "voucher_date": loan.application_date,
                     "due_date": row.due_date, "voucher_no": loan.doc_no or loan.loan_no or "", "particulars": f"{loan.loan_type.name} Inst #{row.installment_number}",
                     "loan_id": loan.id, "due_amount": due, "paid": paid, "pending": pending})
    for due in PartyDue.objects.filter(party_id__in=list(by_id), due_date__lte=as_of).select_related("party").prefetch_related("allocations"):
        paid = sum((a.amount for a in due.allocations.all() if a.date <= as_of), ZERO)
        pending = due.amount - paid
        if pending <= 0:
            continue
        rows.append({"kind": "partydue", "record_id": due.id, "party_id": due.party_id, "party_name": due.party.name, "voucher_date": due.due_date,
                     "due_date": due.due_date, "voucher_no": due.voucher_no, "particulars": due.due_number, "loan_id": None,
                     "due_amount": due.amount, "paid": paid, "pending": pending})
    return rows


def _unallocated_advance(parties, as_of):
    """Credit received on account (Others / Advance) not applied to any due. Reported, never netted."""
    total = ZERO
    customers = [item.customer_id for item in parties if item.customer_id]
    for item in CollectionTransaction.objects.filter(customer_id__in=customers, collection_date__lte=as_of):
        total += item.advance_amount or ZERO
    for receipt in PartyCollection.objects.filter(party_id__in=[item.id for item in parties], date__lte=as_of).prefetch_related("allocations"):
        total += receipt.amount - sum((a.amount for a in receipt.allocations.all() if a.date <= as_of), ZERO)
    return total


def _multiple(params, parties, basis, start, end):
    as_of = end or timezone.localdate()
    rows = _due_rows(parties, as_of)
    key = "due_date" if basis == "due" else "voucher_date"
    rows = [row for row in rows if (not start or row[key] >= start) and (not end or row[key] <= end)]
    for row in rows:
        row["overdue_days"] = max(0, (as_of - row["due_date"]).days)
    if params.get("sort") == "party":
        rows.sort(key=lambda row: (row["party_name"].lower(), row["due_date"], row["voucher_no"], row["record_id"]))
    else:
        rows.sort(key=lambda row: (row["due_date"], row["party_name"].lower(), row["voucher_no"], row["record_id"]))
    totals = {name: sum((row[source] for row in rows), ZERO) for name, source in (("due", "due_amount"), ("paid", "paid"), ("pending", "pending"))}
    totals["unallocated_advance"] = _unallocated_advance(parties, as_of)
    return {"view": "multiple", "as_of": as_of, "count": len(rows), "rows": rows, "totals": totals}


def _entries(parties, cutoff):
    """Every posting of each party ledger as (party id -> list of entries); DR/CR as stored."""
    ids = [item.id for item in parties]
    by_customer = {item.customer_id: item for item in parties if item.customer_id}
    out = {item.id: [] for item in parties}

    def add(party_id, voucher_date, order, record_id, particulars, voucher_no, due_date=None, debit=ZERO, credit=ZERO, open_with=None):
        out[party_id].append({"voucher_date": voucher_date, "due_date": due_date, "order": order, "record_id": record_id, "particulars": particulars,
                              "voucher_no": voucher_no, "debit": debit, "credit": credit, "open": open_with})

    installments = (CustomerLoanInstallmentDetails.objects.filter(loan__customer_id__in=list(by_customer), due_date__lte=cutoff)
                    .select_related("loan__customer", "loan__loan_type", "loan__chit_details__chit_group"))
    for row in installments:
        loan = row.loan
        chit = getattr(loan, "chit_details", None)
        label = chit.chit_group.name if chit else f"{loan.loan_type.name} Loan"
        add(by_customer[loan.customer_id].id, row.due_date, 0, row.id, f"{label} (Inst #{row.installment_number})", loan.doc_no or loan.loan_no or "",
            due_date=row.due_date, debit=row.installment_amount or ZERO, open_with={"kind": "installment", "id": row.id})
    for item in CollectionTransaction.objects.filter(customer_id__in=list(by_customer)).select_related("loan"):
        add(by_customer[item.customer_id].id, item.collection_date, 1, item.id, f"Collection ({item.loan.loan_no or item.loan.doc_no})", f"RV-{item.id:06d}",
            credit=item.collection_amount or ZERO)
    for due in PartyDue.objects.filter(party_id__in=ids).select_related("counter_ledger"):
        add(due.party_id, due.due_date, 2, due.id, f"{due.due_number} ({due.counter_ledger.name})", due.voucher_no, due_date=due.due_date, debit=due.amount)
    for receipt in PartyCollection.objects.filter(party_id__in=ids).select_related("account"):
        add(receipt.party_id, receipt.date, 3, receipt.id, f"Collection ({receipt.account.name})", receipt.voucher_no, credit=receipt.amount)
    for line in JournalLine.objects.filter(ledger_id__in=ids).select_related("voucher"):
        debit = line.side == JournalLine.DEBIT
        add(line.ledger_id, line.voucher.date, 4, line.id, line.voucher.narration or "Journal", line.voucher.voucher_no,
            debit=line.amount if debit else ZERO, credit=ZERO if debit else line.amount)
    for payment in PaymentEntry.objects.filter(ledger_id__in=ids).select_related("account"):
        add(payment.ledger_id, payment.date, 5, payment.id, f"Payment ({payment.account.name if payment.account else payment.payment_mode})", f"PV-{payment.id:06d}", debit=payment.amount)
    return out


def _individual(params, parties, basis, start, end):
    cutoff = end or timezone.localdate()

    def key(entry):
        return (entry["due_date"] or entry["voucher_date"]) if basis == "due" else entry["voucher_date"]

    entries, sections = _entries(parties, cutoff), []
    for party in parties:
        ordered = sorted(entries[party.id], key=lambda entry: (key(entry), entry["order"], entry["record_id"]))
        opening = (party.opening_balance or ZERO) + sum((e["debit"] - e["credit"] for e in ordered if start and key(e) < start), ZERO)
        visible = [e for e in ordered if (not start or key(e) >= start) and (not end or key(e) <= end)]
        running, rows, debit_total, credit_total = opening, [], ZERO, ZERO
        for entry in visible:
            running += entry["debit"] - entry["credit"]
            debit_total += entry["debit"]
            credit_total += entry["credit"]
            amount, side = _signed(running)
            rows.append({"voucher_date": entry["voucher_date"], "due_date": entry["due_date"], "particulars": entry["particulars"], "voucher_no": entry["voucher_no"],
                         "debit": entry["debit"], "credit": entry["credit"], "balance": amount, "balance_type": side, "open": entry["open"]})
        if not rows and not opening and len(parties) > 1:
            continue
        opening_amount, opening_side = _signed(opening)
        closing_amount, closing_side = _signed(running)
        sections.append({"party_id": party.id, "party_name": party.name, "opening": opening_amount, "opening_type": opening_side, "rows": rows,
                         "total_debit": debit_total, "total_credit": credit_total, "closing": closing_amount, "closing_type": closing_side})
    sections.sort(key=lambda section: section["party_name"].lower())
    return {"view": "individual", "parties": sections, "count": sum(len(item["rows"]) for item in sections),
            "totals": {"debit": sum((item["total_debit"] for item in sections), ZERO), "credit": sum((item["total_credit"] for item in sections), ZERO)}}


@api_view(["GET"])
def pending_outstanding(request):
    params = request.query_params
    basis = "due" if params.get("basis") == "due" else "voucher"
    try:
        single = _parse_date(params.get("date"))
        start, end = (single, single) if single else (_parse_date(params.get("from")), _parse_date(params.get("to")))
    except ValueError:
        return Response({"detail": "Enter valid report dates."}, status=400)
    if start and end and start > end:
        return Response({"detail": "From Date cannot be after To Date."}, status=400)
    parties = _selected(params)
    build = _individual if params.get("view") == "individual" else _multiple
    return Response({"basis": basis, "from": start, "to": end, "party_count": len(parties), **build(params, parties, basis, start, end)})
