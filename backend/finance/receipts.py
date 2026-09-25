from decimal import Decimal

from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import CollectionTransaction

ZERO = Decimal("0.00")
LOAN_TYPES = ("CHIT", "INTEREST", "MORTGAGE")


def voucher_no(collection):
    return f"RV-{collection.pk:06d}"


def _date(value):
    return value.strftime("%d/%m/%Y") if value else ""


def _number(value):
    text = f"{value:,.3f}".rstrip("0").rstrip(".") if value is not None else ""
    return text


def _loan_kind(loan):
    name = (loan.loan_type.name or "").strip().upper()
    return name if name in LOAN_TYPES else name or "LOAN"


def _loan_label(loan, kind):
    ref = loan.loan_no or loan.doc_no
    if kind == "CHIT":
        group = getattr(getattr(getattr(loan, "chit_details", None), "chit_group", None), "name", "")
        return " · ".join(filter(None, ["Chit", ref, group]))
    if kind == "INTEREST":
        details = getattr(loan, "interest_details", None)
        plan = f"{_number(details.interest_percentage)}% {details.loan_installment.name}" if details else ""
        return " · ".join(filter(None, ["Interest Loan", ref, plan]))
    if kind == "MORTGAGE":
        details = getattr(loan, "mortgage_details", None)
        item = " ".join(filter(None, [details.product_name, _number(details.quantity), details.unit])) if details else ""
        return " · ".join(filter(None, ["Mortgage", ref, item]))
    return " · ".join(filter(None, [loan.loan_type.name, ref]))


def _allocations(collection, cache):
    """[(installment or None, amount)] for one collection.

    Collections saved with a stored split use it. Older ones are rebuilt by replaying the
    loan's collections oldest-first, the same order the collect endpoint pays installments in.
    """
    stored = [(item.installment, item.amount) for item in collection.allocations.all()]
    if stored:
        return stored
    loan = collection.loan
    if loan.pk not in cache:
        rows = list(loan.installment_details.all().order_by("due_date", "installment_number"))
        paid = {row.pk: ZERO for row in rows}
        rebuilt = {}
        for item in loan.collection_transactions.prefetch_related("allocations__installment").order_by("id"):
            split = [(a.installment, a.amount) for a in item.allocations.all()]
            if not split:
                remaining = item.collection_amount
                for row in rows:
                    balance = max(ZERO, row.installment_amount - paid[row.pk])
                    if remaining <= 0 or balance <= 0:
                        continue
                    applied = min(balance, remaining)
                    split.append((row, applied))
                    remaining -= applied
                if remaining > 0:
                    split.append((None, remaining))
            for row, amount in split:
                if row is not None:
                    paid[row.pk] = paid.get(row.pk, ZERO) + amount
            rebuilt[item.pk] = split
        cache[loan.pk] = rebuilt
    return cache[loan.pk].get(collection.pk, [(collection.installment, collection.collection_amount)])


def _customer(customer):
    place = ", ".join(filter(None, [customer.district, customer.state]))
    if customer.pincode:
        place = f"{place} - {customer.pincode}" if place else customer.pincode
    return {"name": customer.full_name, "code": customer.customer_code, "phone": customer.primary_mobile,
            "address": [line for line in [customer.address.strip() if customer.address else "", place] if line]}


def build_receipt(collections):
    """One section per loan type, so Chit, Interest and Mortgage are never mixed."""
    cache, sections = {}, {}
    for collection in collections:
        loan = collection.loan
        kind = _loan_kind(loan)
        label = _loan_label(loan, kind)
        section = sections.setdefault(kind, {"loan_type": kind, "vouchers": [], "dates": [], "modes": [], "references": [], "notes": [], "rows": []})
        section["vouchers"].append(voucher_no(collection))
        section["dates"].append(collection.collection_date)
        section["modes"].append(collection.payment_mode)
        if collection.reference_no: section["references"].append(collection.reference_no)
        if collection.remarks: section["notes"].append(collection.remarks)
        for installment, amount in _allocations(collection, cache):
            due = f"Installment #{installment.installment_number} (Due {_date(installment.due_date)})" if installment else "Advance (not yet allocated to a due)"
            section["rows"].append({"particulars": f"{label} — {due}", "amount": amount})
    result = []
    for kind in sorted(sections, key=lambda key: (LOAN_TYPES.index(key) if key in LOAN_TYPES else len(LOAN_TYPES), key)):
        section = sections[kind]
        result.append({"loan_type": kind, "voucher_no": ", ".join(section["vouchers"]), "date": _date(max(section["dates"])),
                       "payment_mode": ", ".join(dict.fromkeys(section["modes"])), "reference_no": ", ".join(section["references"]),
                       "notes": " | ".join(section["notes"]), "rows": section["rows"],
                       "total": sum((row["amount"] for row in section["rows"]), ZERO)})
    return result


@api_view(["GET"])
def collection_receipt(request):
    try:
        ids = [int(value) for value in request.query_params.get("ids", "").split(",") if value.strip()]
    except ValueError:
        return Response({"detail": "Select valid collection records."}, status=400)
    if not ids:
        return Response({"detail": "Select a collection record."}, status=400)
    collections = list(CollectionTransaction.objects.filter(pk__in=ids).select_related(
        "customer", "installment", "loan", "loan__loan_type", "loan__chit_details__chit_group",
        "loan__interest_details__loan_installment", "loan__mortgage_details").prefetch_related("allocations__installment").order_by("id"))
    if len(collections) != len(set(ids)):
        return Response({"detail": "One or more collection records were not found."}, status=404)
    if len({item.customer_id for item in collections}) > 1:
        return Response({"detail": "A receipt can include collections of one customer only."}, status=400)
    return Response({"customer": _customer(collections[0].customer), "sections": build_receipt(collections)})
