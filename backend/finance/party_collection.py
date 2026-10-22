"""Party Collection: ledger-based collections for Sundry Debtors parties, independent of
the Customer/Loan Collection Entry. The same receipt voucher also records a Collection
Entry against a general ledger that has no loans (e.g. Rent, Fees): no due split-up.

* PartyDue        -- a receivable: Dr Party, Cr the chosen counter ledger.
* PartyCollection -- a receipt voucher: Dr Cash/Bank account, Cr Party.
* PartyAllocation -- applies receipt money to a due. It never posts: applying an
  unallocated advance later moves no Cash/Bank and creates no second voucher.

A party's unallocated advance is its receipts minus their allocations; its outstanding
is the party ledger's actual balance (accounting_reports.ledger_balances).
"""
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Sum, Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from .cash_bank import LedgerMappingError, is_account_ledger, resolve_account
from .models import Ledger, PartyAllocation, PartyCollection, PartyDue, PaymentEntry
from .views import FinanceViewSet

ZERO = Decimal("0.00")
# Payment details each bank mode needs (same as Collection Entry); every other detail is cleared.
MODE_DETAILS = {"UPI": ("upi_id", "transaction_utr"), "Cheque": ("cheque_number", "cheque_date", "bank_name"),
                "NEFT": ("transaction_utr", "bank_name"), "RTGS": ("transaction_utr", "bank_name"), "IMPS": ("transaction_utr", "bank_name")}
DETAIL_FIELDS = ("upi_id", "transaction_utr", "bank_name", "cheque_number", "cheque_date")


def is_party(ledger):
    return ledger is not None and ledger.group == Ledger.DEBTORS_GROUP and bool(ledger.collection_type)


def allocated_to(due):
    return due.allocations.aggregate(total=Sum("amount"))["total"] or ZERO


def allocated_from(collection):
    return collection.allocations.aggregate(total=Sum("amount"))["total"] or ZERO


def unallocated_advance(party):
    received = PartyCollection.objects.filter(party=party).aggregate(total=Sum("amount"))["total"] or ZERO
    allocated = PartyAllocation.objects.filter(collection__party=party).aggregate(total=Sum("amount"))["total"] or ZERO
    return received - allocated


def lock_party(party_id):
    """Serialize every due / receipt / allocation change of one party."""
    return Ledger.objects.select_for_update().get(pk=party_id)


def money(value, field):
    try:
        amount = Decimal(str(value if value not in (None, "") else "0")).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        raise serializers.ValidationError({field: "Enter a valid amount."})
    if not amount.is_finite() or amount < 0:
        raise serializers.ValidationError({field: "Enter a valid amount."})
    return amount


def parse_allocations(rows, party, field="allocations"):
    """[{due, amount}] -> [(PartyDue, Decimal)], each due of this party, listed once,
    never above its pending amount. Zero rows are dropped."""
    if rows in (None, ""):
        return []
    if not isinstance(rows, list):
        raise serializers.ValidationError({field: "Send the allocations as a list."})
    seen, result = set(), []
    for row in rows:
        due_id = str((row or {}).get("due", "")).strip()
        amount = money((row or {}).get("amount"), field)
        if not amount:
            continue
        due = PartyDue.objects.filter(pk=due_id, party=party).first() if due_id.isdigit() else None
        if due is None:
            raise serializers.ValidationError({field: "Select a pending due of this party."})
        if due.pk in seen:
            raise serializers.ValidationError({field: f"{due.due_number} is listed more than once."})
        seen.add(due.pk)
        pending = due.amount - allocated_to(due)
        if amount > pending:
            raise serializers.ValidationError({field: f"{due.due_number}: allocation exceeds its pending amount {pending:.2f}."})
        result.append((due, amount))
    return result


class PartyDueSerializer(serializers.ModelSerializer):
    voucher_no = serializers.CharField(read_only=True)
    party_name = serializers.CharField(source="party.name", read_only=True)
    counter_ledger_name = serializers.CharField(source="counter_ledger.name", read_only=True)
    collected = serializers.SerializerMethodField()
    pending = serializers.SerializerMethodField()

    class Meta:
        model = PartyDue
        fields = ("id", "voucher_no", "party", "party_name", "counter_ledger", "counter_ledger_name", "due_date", "due_number",
                  "amount", "notes", "done_by_staff", "collected", "pending", "created_by", "create_date")
        read_only_fields = ("created_by", "create_date")

    def get_collected(self, obj):
        return allocated_to(obj)

    def get_pending(self, obj):
        return obj.amount - allocated_to(obj)

    def validate_due_number(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Due Number is required.")
        return value

    def validate(self, attrs):
        current = lambda key: attrs.get(key, getattr(self.instance, key, None))
        party, counter, amount = current("party"), current("counter_ledger"), current("amount")
        errors = {}
        if not is_party(party):
            errors["party"] = "Select a Sundry Debtors party with a Collection Type."
        if self.instance is not None and "party" in attrs and attrs["party"].pk != self.instance.party_id:
            errors["party"] = "A due cannot be moved to another party."
        if counter is None or is_account_ledger(counter) or (party is not None and counter.pk == party.pk):
            errors["counter_ledger"] = "Select the ledger to credit for this due (not the party, Cash or Bank)."
        if amount is None or amount <= 0:
            errors["amount"] = "Due Amount must be greater than zero."
        elif self.instance is not None and amount < allocated_to(self.instance):
            errors["amount"] = f"Due Amount cannot be less than the {allocated_to(self.instance):.2f} already collected."
        number = current("due_number")
        if party is not None and number:
            clash = PartyDue.objects.filter(party=party, due_number__iexact=number)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                errors["due_number"] = "This Due Number already exists for the party."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class PartyDueViewSet(FinanceViewSet):
    queryset = PartyDue.objects.select_related("party", "counter_ledger").all()
    serializer_class = PartyDueSerializer
    delete_label = "due"
    pagination_class = None

    def get_queryset(self):
        rows = super().get_queryset()
        party = self.request.query_params.get("party", "").strip()
        return rows.filter(party_id=party) if party.isdigit() else rows

    @transaction.atomic
    def perform_create(self, serializer):
        lock_party(serializer.validated_data["party"].pk)
        serializer.save(created_by=self.request.user.get_username())

    @transaction.atomic
    def perform_update(self, serializer):
        lock_party(serializer.instance.party_id)
        serializer.save(modified_by=self.request.user.get_username())


class PartyCollectionSerializer(serializers.ModelSerializer):
    voucher_no = serializers.CharField(read_only=True)
    party_name = serializers.CharField(source="party.name", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True)
    collection_type = serializers.CharField(source="party.collection_type", read_only=True)
    allocations = serializers.SerializerMethodField()
    allocated = serializers.SerializerMethodField()

    class Meta:
        model = PartyCollection
        fields = ("id", "voucher_no", "party", "party_name", "collection_type", "account", "account_name", "date", "amount",
                  "payment_mode", *DETAIL_FIELDS, "notes", "done_by_staff", "allocations", "allocated", "created_by", "create_date")
        read_only_fields = ("created_by", "create_date")

    def get_allocations(self, obj):
        return [{"id": row.id, "due": row.due_id, "due_number": row.due.due_number, "amount": row.amount, "date": row.date,
                 "from_advance": row.from_advance} for row in obj.allocations.select_related("due")]

    def get_allocated(self, obj):
        return allocated_from(obj)

    def validate(self, attrs):
        current = lambda key: attrs.get(key, getattr(self.instance, key, None))
        party, mode, amount = current("party"), current("payment_mode"), current("amount")
        errors = {}
        # Any Ledger Master ledger can receive a collection (a party, or a general ledger such
        # as Rent / Fees from Collection Entry); Cash and Bank belong only on the Accounts side.
        if party is None or is_account_ledger(party):
            errors["party"] = "Select a Ledger. Cash in Hand and Bank Accounts belong in Accounts."
        if self.instance is not None and "party" in attrs and attrs["party"].pk != self.instance.party_id:
            errors["party"] = "A collection cannot be moved to another party."
        if amount is None or amount <= 0:
            errors["amount"] = "Collection Amount must be greater than zero."
        elif self.instance is not None and amount < allocated_from(self.instance):
            errors["amount"] = f"Collection Amount cannot be less than the {allocated_from(self.instance):.2f} already allocated to dues."
        if mode not in dict(PaymentEntry.PAYMENT_MODES):
            errors["payment_mode"] = "Select a Payment Mode."
        elif current("account") is None:
            errors["account"] = "Select an Account."
        else:
            try:
                attrs["account"] = resolve_account(mode, current("account"))
            except LedgerMappingError as error:
                errors[error.field] = error.message
        needed = MODE_DETAILS.get(mode, ())
        for key in needed:
            if not current(key):
                errors[key] = "This field is required."
        if errors:
            raise serializers.ValidationError(errors)
        # Keep only the details of the chosen mode.
        for key in DETAIL_FIELDS:
            if key not in needed:
                attrs[key] = None if key == "cheque_date" else ""
        return attrs


class PartyCollectionViewSet(FinanceViewSet):
    queryset = PartyCollection.objects.select_related("party", "account").all()
    serializer_class = PartyCollectionSerializer
    delete_label = "party collection"
    pagination_class = None

    def get_queryset(self):
        rows = super().get_queryset()
        party = self.request.query_params.get("party", "").strip()
        return rows.filter(party_id=party) if party.isdigit() else rows

    @transaction.atomic
    def perform_create(self, serializer):
        party = lock_party(serializer.validated_data["party"].pk)
        amount = serializer.validated_data["amount"]
        data = self.request.data
        if is_party(party) and party.collection_type == Ledger.DUE_WISE:
            # Due-wise: the selected dues plus Others (advance) must add up to the receipt.
            rows = parse_allocations(data.get("allocations"), party)
            advance = money(data.get("advance_amount"), "advance_amount")
            if sum((value for _, value in rows), ZERO) + advance != amount:
                raise serializers.ValidationError({"allocations": "Allocated dues plus Others must equal the Collection Amount."})
        else:
            # Consolidated party or general ledger: one receipt against the ledger, never split by due.
            if parse_allocations(data.get("allocations"), party):
                raise serializers.ValidationError({"allocations": "This ledger is collected without due allocation."})
            rows = []
        collection = serializer.save(party=party, created_by=self.request.user.get_username())
        PartyAllocation.objects.bulk_create([PartyAllocation(collection=collection, due=due, amount=value, date=collection.date)
                                             for due, value in rows])

    @transaction.atomic
    def perform_update(self, serializer):
        lock_party(serializer.instance.party_id)
        serializer.save(modified_by=self.request.user.get_username())

    @action(detail=False, methods=["post"], url_path="allocate-advance")
    @transaction.atomic
    def allocate_advance(self, request):
        """Apply a party's unallocated advance to its dues. No receipt, no Cash/Bank posting:
        the allocation is drawn from earlier receipts that still have money unallocated."""
        party_id = str(request.data.get("party", "")).strip()
        party = Ledger.objects.filter(pk=party_id).first() if party_id.isdigit() else None
        if not is_party(party) or party.collection_type != Ledger.DUE_WISE:
            return Response({"party": "Select a Due-wise party."}, status=400)
        party = lock_party(party.pk)
        rows = parse_allocations(request.data.get("allocations"), party)
        total = sum((value for _, value in rows), ZERO)
        available = unallocated_advance(party)
        if not rows:
            return Response({"allocations": "Enter an amount for at least one due."}, status=400)
        if total > available:
            return Response({"allocations": f"Allocation {total:.2f} exceeds the unallocated advance {available:.2f}."}, status=400)
        on = request.data.get("date") or timezone.localdate()
        # Oldest receipts with money left are used first.
        sources = []
        for receipt in PartyCollection.objects.filter(party=party).order_by("date", "id"):
            left = receipt.amount - allocated_from(receipt)
            if left > 0:
                sources.append([receipt, left])
        created = []
        for due, value in rows:
            while value > 0:
                source = next(item for item in sources if item[1] > 0)
                part = min(value, source[1])
                created.append(PartyAllocation(collection=source[0], due=due, amount=part, date=on, from_advance=True))
                source[1] -= part
                value -= part
        PartyAllocation.objects.bulk_create(created)
        return Response(party_summary(party), status=201)

    @action(detail=False, methods=["get"], url_path="ledger-options")
    def ledger_options(self, request):
        """Ledgers that can carry a Ledger Outstanding: customer-linked Party Ledgers, Sundry
        Debtors parties, and any other ledger with saved dues or receipts against it."""
        from .models import CollectionTransaction
        active = (set(PartyDue.objects.values_list("party_id", flat=True))
                  | set(PartyCollection.objects.values_list("party_id", flat=True))
                  | set(CollectionTransaction.objects.exclude(party_ledger__isnull=True).values_list("party_ledger_id", flat=True)))
        rows = Ledger.objects.select_related("customer").filter(
            Q(customer__isnull=False) | Q(group=Ledger.DEBTORS_GROUP) | Q(pk__in=active)).order_by("name", "id")
        return Response([{"id": row.pk, "name": row.name, "group": row.group, "customer": row.customer_id,
                          "customer_name": row.customer.full_name if row.customer_id else "",
                          "customer_code": row.customer.customer_code if row.customer_id else ""}
                         for row in rows if not is_account_ledger(row)])

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        party_id = str(request.query_params.get("party", "")).strip()
        party = Ledger.objects.filter(pk=party_id).first() if party_id.isdigit() else None
        if party is None or is_account_ledger(party):
            return Response({"party": "Select an eligible Ledger."}, status=400)
        if request.query_params.get("view") == "ledger":
            return Response(ledger_outstanding(party, request.query_params))
        return Response(party_summary(party))


def party_summary(party):
    """Totals (and, for Due-wise parties, the due-wise split-up) of one party. Outstanding
    is the party ledger's actual balance, so it includes its opening balance and every posting."""
    from .accounting_reports import ledger_balances
    dues = list(PartyDue.objects.filter(party=party).select_related("counter_ledger").order_by("due_date", "id"))
    collected = {row["due_id"]: row["total"] for row in PartyAllocation.objects.filter(due__party=party).values("due_id").annotate(total=Sum("amount"))}
    total_due = sum((due.amount for due in dues), ZERO)
    receipts = list(PartyCollection.objects.filter(party=party).order_by("date", "id"))
    total_received = sum((receipt.amount for receipt in receipts), ZERO)
    _, balances, _ = ledger_balances()
    balance = balances.get(party.pk, ZERO)
    data = {
        "party": party.pk, "party_name": party.name, "collection_type": party.collection_type,
        "total_due": total_due, "total_received": total_received,
        "outstanding": abs(balance), "outstanding_type": "CR" if balance < 0 else "DR",
        "last_counter_ledger": dues[-1].counter_ledger_id if dues else None,
    }
    # Receipt allocations do not post again: dated history is built from vouchers only.
    entries = [{"id": f"due-{due.pk}", "date": due.due_date, "particulars": "Due", "reference": due.due_number,
                "debit": due.amount, "credit": ZERO} for due in dues]
    entries += [{"id": f"collection-{receipt.pk}", "date": receipt.date,
                 "particulars": "Collection" if is_party(party) and allocated_from(receipt) else "Others Collection",
                 "reference": receipt.voucher_no, "debit": ZERO, "credit": receipt.amount} for receipt in receipts]
    entries.sort(key=lambda row: (row["date"], 0 if row["debit"] else 1, row["id"]))
    data.update({"entries": entries, "remaining_outstanding": max(ZERO, total_due - total_received),
                 "unallocated_credit": unallocated_advance(party),
                 "due_balance": abs(total_due - total_received), "due_balance_type": "CR" if total_received > total_due else "DR"})
    if not is_party(party):
        data["unallocated_advance"] = data["unallocated_credit"]
    if party.collection_type == Ledger.DUE_WISE:
        rows = [{"id": due.id, "voucher_no": due.voucher_no, "due_date": due.due_date, "due_number": due.due_number,
                 "amount": due.amount, "collected": collected.get(due.id, ZERO), "pending": due.amount - collected.get(due.id, ZERO),
                 "notes": due.notes, "counter_ledger": due.counter_ledger_id, "counter_ledger_name": due.counter_ledger.name} for due in dues]
        data.update({"dues": rows, "total_collected": sum((row["collected"] for row in rows), ZERO),
                     "total_pending": sum((row["pending"] for row in rows), ZERO), "unallocated_advance": unallocated_advance(party)})
    return data


def ledger_outstanding(party, params):
    """Saved due/receipt history of one ledger, posted the same way as accounting_reports.
    ledger_balances. Allocations explain dues; they never add ledger credits. A due that is not
    yet due but already has money collected against it is shown, so each collection sits next
    to the due it settles (Due 5,000 Dr / Collection 1,000 Cr -> 4,000 pending)."""
    from datetime import date
    from .models import CustomerLoanInstallmentDetails, CollectionTransaction, JournalLine
    try:
        cutoff = date.fromisoformat(params["to"]) if params.get("to") else timezone.localdate()
        start = date.fromisoformat(params["from"]) if params.get("from") else None
    except (ValueError, TypeError):
        raise serializers.ValidationError({"date": "Enter valid From and To dates."})
    if start and start > cutoff:
        raise serializers.ValidationError({"from": "From Date must not follow To Date."})
    due_rows = []
    entries = []
    loan_paid = {}
    allocated = ZERO
    received = ZERO
    loans = CustomerLoanInstallmentDetails.objects.filter(loan__customer_id=party.customer_id).select_related("loan") if party.customer_id else CustomerLoanInstallmentDetails.objects.none()
    loan_dues = list(loans)
    loan_ids = {row.pk for row in loan_dues}
    receipt_filter = Q(party_ledger=party)
    if party.customer_id:
        receipt_filter |= Q(party_ledger__isnull=True, customer_id=party.customer_id)
    receipts = CollectionTransaction.objects.filter(receipt_filter, collection_date__lte=cutoff).select_related("loan").prefetch_related("allocations")
    for receipt in receipts:
        splits = list(receipt.allocations.all())
        credited = sum((split.amount for split in splits), ZERO)
        if not splits:
            credited = receipt.collection_amount - receipt.advance_amount
            if receipt.installment_id in loan_ids:
                loan_paid[receipt.installment_id] = loan_paid.get(receipt.installment_id, ZERO) + credited
        else:
            for split in splits:
                if split.installment_id in loan_ids:
                    loan_paid[split.installment_id] = loan_paid.get(split.installment_id, ZERO) + split.amount
        # A legacy "Other Charges" share credits its own ledger, not the party.
        share = receipt.ledger_amount or ZERO
        party_credit = receipt.collection_amount - share if receipt.ledger_id != party.pk else receipt.collection_amount
        allocated += credited
        received += party_credit
        label = "Others" if not credited else "Collection / Others" if receipt.advance_amount else "Collection"
        entries.append({"id": f"loan-receipt-{receipt.pk}", "source_id": receipt.pk, "date": receipt.collection_date,
                        "particulars": label, "reference": f"RV-{receipt.pk:06d}", "loan_no": receipt.loan.loan_no,
                        "debit": ZERO, "credit": party_credit})
    # Other Charges shares of receipts filed under another party that credit this ledger.
    for receipt in CollectionTransaction.objects.filter(ledger=party, ledger_amount__gt=0, collection_date__lte=cutoff).exclude(receipt_filter).select_related("loan"):
        entries.append({"id": f"charge-receipt-{receipt.pk}", "source_id": receipt.pk, "date": receipt.collection_date,
                        "particulars": "Other Charges", "reference": f"RV-{receipt.pk:06d}", "loan_no": receipt.loan.loan_no,
                        "debit": ZERO, "credit": receipt.ledger_amount})
    # Payment Entry against this ledger (Dr ledger / Cr Cash-Bank).
    for payment in PaymentEntry.objects.filter(ledger=party, date__lte=cutoff):
        entries.append({"id": f"payment-{payment.pk}", "source_id": payment.pk, "date": payment.date,
                        "particulars": "Payment", "reference": f"PV-{payment.pk:06d}", "loan_no": "",
                        "debit": payment.amount, "credit": ZERO})
    # Journal Entry adjustments posted to this ledger.
    for line in JournalLine.objects.filter(ledger=party, voucher__date__lte=cutoff).select_related("voucher"):
        debit = line.side == JournalLine.DEBIT
        entries.append({"id": f"journal-{line.pk}", "source_id": line.voucher_id, "date": line.voucher.date,
                        "particulars": "Journal Adjustment", "reference": line.voucher.voucher_no, "loan_no": "",
                        "debit": line.amount if debit else ZERO, "credit": ZERO if debit else line.amount})
    for row in loan_dues:
        due_rows.append({"id": f"installment-{row.pk}", "source_id": row.pk, "loan_id": row.loan_id, "loan_no": row.loan.loan_no,
                         "date": row.due_date, "amount": row.installment_amount, "paid": loan_paid.get(row.pk, ZERO),
                         "reference": f"{row.loan.loan_no} / Due {row.installment_number}"})
    party_paid = {}
    party_receipts = PartyCollection.objects.filter(party=party, date__lte=cutoff).prefetch_related("allocations")
    for receipt in party_receipts:
        splits = list(receipt.allocations.all())
        applied = ZERO
        initial = sum((split.amount for split in splits if not split.from_advance), ZERO)
        for split in splits:
            if split.date <= cutoff:
                party_paid[split.due_id] = party_paid.get(split.due_id, ZERO) + split.amount
                applied += split.amount
        allocated += applied
        received += receipt.amount
        label = "Others" if not initial else "Collection / Others" if initial < receipt.amount else "Collection"
        entries.append({"id": f"party-receipt-{receipt.pk}", "source_id": receipt.pk, "date": receipt.date,
                        "particulars": label, "reference": receipt.voucher_no, "loan_no": "", "debit": ZERO, "credit": receipt.amount})
    for due in PartyDue.objects.filter(party=party):
        due_rows.append({"id": f"party-due-{due.pk}", "source_id": due.pk, "loan_id": None, "loan_no": "",
                         "date": due.due_date, "amount": due.amount, "paid": party_paid.get(due.pk, ZERO), "reference": due.due_number})
    # Through the cutoff: dues already due, plus later dues that already have collections against them.
    eligible = [row for row in due_rows if row["date"] <= cutoff or row["paid"] > ZERO]
    transaction_dues = due_rows if params.get("due_scope") == "all_saved" else eligible
    for due in transaction_dues:
        entries.append({"id": due["id"], "source_id": due["source_id"], "date": due["date"], "particulars": "Due",
                        "reference": due["reference"], "loan_no": due["loan_no"], "debit": due["amount"], "credit": ZERO})
    entries.sort(key=lambda row: (row["date"], 0 if row["debit"] else 1, row["source_id"], row["id"]))
    running = party.opening_balance or ZERO
    opening = running
    visible = []
    for entry in entries:
        running += entry["debit"] - entry["credit"]
        entry["balance"] = running
        entry["balance_type"] = "CR" if running < ZERO else "DR"
        if start and entry["date"] < start:
            opening = running
        else:
            visible.append(entry)
    needle = str(params.get("search", "")).strip().lower()
    if needle:
        visible = [row for row in visible if needle in f"{row['particulars']} {row['reference']} {row['loan_no']}".lower()]
    pending = sum((max(ZERO, row["amount"] - row["paid"]) for row in eligible), ZERO)
    future = sum((max(ZERO, row["amount"] - row["paid"]) for row in due_rows if row["date"] > cutoff and row["paid"] <= ZERO), ZERO)
    customer_name = party.customer.full_name if party.customer_id else party.name
    return {"party": party.pk, "party_name": party.name, "customer_id": party.customer_id, "customer_name": customer_name, "cutoff": cutoff,
            "entries": visible, "opening_balance": opening, "closing_balance": running,
            "total_due": sum((row["amount"] for row in transaction_dues), ZERO), "allocated_collection": allocated,
            "due_pending": pending, "unallocated_others": max(ZERO, received - allocated),
            "future_receivables": future, "total_outstanding": pending + future,
            "dues": [{**row, "pending": max(ZERO, row["amount"] - row["paid"])} for row in due_rows]}
