"""Journal Entry: a balanced accounting voucher (JV-xxxxxx) between any Ledger Master ledgers.

The form sends grid rows -- each row has an optional Credit ledger/amount and an optional
Debit ledger/amount. They are stored as JournalLine postings (one per filled side), which
accounting_reports.ledger_balances and the ledger statements read directly, so every report
uses the same posting data. A journal is never a Collection or Payment Entry and never
appears in Today Report.
"""
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.response import Response

from .cash_bank import is_account_ledger
from .models import JournalAudit, JournalLine, JournalVoucher, Ledger
from .views import FinanceViewSet

ZERO = Decimal("0.00")
MAX_ROWS = 200
CENT = Decimal("0.01")


def _amount(value, label):
    if value in (None, ""):
        return ZERO
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise serializers.ValidationError({"detail": f"{label}: enter a valid amount."})
    if not amount.is_finite() or amount < 0:
        raise serializers.ValidationError({"detail": f"{label}: amounts cannot be negative."})
    if amount != amount.quantize(CENT) or amount >= Decimal("1e16"):
        raise serializers.ValidationError({"detail": f"{label}: use at most two decimal places."})
    return amount.quantize(CENT)


def parse_rows(rows, keep_ledgers=()):
    """Grid rows -> [(row_no, side, Ledger, amount)] for a balanced voucher, or a
    ValidationError naming the row at fault. Fully blank rows are ignored. Cash in Hand / Bank
    Accounts ledgers (any depth of those groups) belong to their own modules, so they are refused;
    `keep_ledgers` lets an older voucher that already posts to one be edited without re-picking it."""
    if not isinstance(rows, list) or not rows:
        raise serializers.ValidationError({"detail": "Add at least one journal row."})
    if len(rows) > MAX_ROWS:
        raise serializers.ValidationError({"detail": f"A journal can have at most {MAX_ROWS} rows."})
    wanted, lines = set(), []
    for index, row in enumerate(rows, start=1):
        row = row if isinstance(row, dict) else {}
        filled = False
        sides = {}
        for side, key, label in ((JournalLine.CREDIT, "cr", "Credit"), (JournalLine.DEBIT, "dr", "Debit")):
            ledger_id = str(row.get(f"{key}_ledger") or "").strip()
            amount = _amount(row.get(f"{key}_amount"), f"Row {index} {label} Amount")
            if not ledger_id and not amount:
                continue
            filled = True
            if not ledger_id:
                raise serializers.ValidationError({"detail": f"Row {index}: select the {label} ledger."})
            if not ledger_id.isdigit():
                raise serializers.ValidationError({"detail": f"Row {index}: select a valid {label} ledger."})
            if not amount:
                raise serializers.ValidationError({"detail": f"Row {index}: enter the {label} Amount."})
            wanted.add(int(ledger_id))
            sides[side] = (int(ledger_id), amount)
        if filled and len(sides) == 2 and sides[JournalLine.CREDIT][0] == sides[JournalLine.DEBIT][0]:
            raise serializers.ValidationError({"detail": f"Row {index}: the same ledger cannot be both debited and credited."})
        lines.extend((index, side, ledger_id, amount) for side, (ledger_id, amount) in sides.items())
    ledgers = Ledger.objects.in_bulk(wanted)
    missing = wanted - set(ledgers)
    if missing:
        raise serializers.ValidationError({"detail": "One or more selected ledgers no longer exist. Refresh and select again."})
    for ledger in ledgers.values():
        if is_account_ledger(ledger) and ledger.pk not in keep_ledgers:
            raise serializers.ValidationError({"detail": f"{ledger.name} is a Cash / Bank ledger. Use Collection, Payment or Bank Transactions for cash and bank entries."})
    debit = sum((amount for _, side, _, amount in lines if side == JournalLine.DEBIT), ZERO)
    credit = sum((amount for _, side, _, amount in lines if side == JournalLine.CREDIT), ZERO)
    if not debit or not credit:
        raise serializers.ValidationError({"detail": "Enter at least one Debit and one Credit line."})
    if debit != credit:
        raise serializers.ValidationError({"detail": f"Journal is unbalanced: Total Debit {debit:.2f} and Total Credit {credit:.2f} differ by {abs(debit - credit):.2f}."})
    # Renumber rows densely (blank rows dropped) so the saved grid reopens as entered.
    order = {row: number for number, row in enumerate(sorted({row for row, *_ in lines}), start=1)}
    return [(order[row], side, ledgers[ledger_id], amount) for row, side, ledger_id, amount in lines]


def _date(value):
    if value in (None, ""):
        raise serializers.ValidationError({"detail": "Voucher Date is required."})
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        raise serializers.ValidationError({"detail": "Enter a valid Voucher Date."})


def snapshot(voucher):
    """Plain JSON of a voucher for the audit trail."""
    return {"voucher_no": voucher.voucher_no, "date": voucher.date.isoformat(), "narration": voucher.narration,
            "lines": [{"row": line.row, "side": line.side, "ledger": line.ledger_id, "ledger_name": line.ledger.name, "amount": str(line.amount)}
                      for line in voucher.lines.select_related("ledger").order_by("row", "side")]}


class JournalVoucherSerializer(serializers.ModelSerializer):
    voucher_no = serializers.CharField(read_only=True)
    total = serializers.SerializerMethodField()
    rows = serializers.SerializerMethodField()
    lines = serializers.SerializerMethodField()

    class Meta:
        model = JournalVoucher
        fields = ("id", "voucher_no", "date", "narration", "total", "rows", "lines", "created_by", "create_date", "modified_by", "modified_date")
        read_only_fields = fields

    def _lines(self, obj):
        return sorted(obj.lines.all(), key=lambda line: (line.row, line.side != JournalLine.CREDIT, line.id))

    def get_total(self, obj):
        return sum((line.amount for line in self._lines(obj) if line.side == JournalLine.DEBIT), ZERO)

    def get_lines(self, obj):
        return [{"row": line.row, "side": line.side, "ledger": line.ledger_id, "ledger_name": line.ledger.name, "amount": line.amount} for line in self._lines(obj)]

    def get_rows(self, obj):
        """The voucher in grid shape (Cr ledger/amount | Dr ledger/amount per row) for the form."""
        rows = {}
        for line in self._lines(obj):
            key = "cr" if line.side == JournalLine.CREDIT else "dr"
            row = rows.setdefault(line.row, {"cr_ledger": None, "cr_ledger_name": "", "cr_amount": None, "dr_ledger": None, "dr_ledger_name": "", "dr_amount": None})
            row.update({f"{key}_ledger": line.ledger_id, f"{key}_ledger_name": line.ledger.name, f"{key}_amount": line.amount})
        return [rows[number] for number in sorted(rows)]


class JournalVoucherViewSet(FinanceViewSet):
    queryset = JournalVoucher.objects.prefetch_related("lines__ledger").all()
    serializer_class = JournalVoucherSerializer
    delete_label = "journal voucher"

    def get_queryset(self):
        rows = super().get_queryset()
        params = self.request.query_params
        search = params.get("search", "").strip()
        if search:
            query = Q(lines__ledger__name__icontains=search) | Q(narration__icontains=search)
            code = search.upper().replace("JV-", "").replace("JV", "").strip()
            if code.isdigit():
                query |= Q(pk=int(code))
            rows = rows.filter(query).distinct()
        try:
            start = date.fromisoformat(params["from"]) if params.get("from") else None
            end = date.fromisoformat(params["to"]) if params.get("to") else None
        except ValueError:
            raise serializers.ValidationError({"detail": "Enter a valid From/To date."})
        if start and end and start > end:
            raise serializers.ValidationError({"detail": "From Date cannot be after To Date."})
        if start:
            rows = rows.filter(date__gte=start)
        if end:
            rows = rows.filter(date__lte=end)
        return rows.order_by("-date", "-id")

    def _user(self):
        return self.request.user.get_username()

    def _respond(self, voucher, status):
        voucher = JournalVoucher.objects.prefetch_related("lines__ledger").get(pk=voucher.pk)
        return Response(self.get_serializer(voucher).data, status=status)

    def create(self, request, *args, **kwargs):
        token = str(request.data.get("client_token") or "").strip()
        try:
            token = uuid.UUID(token) if token else uuid.uuid4()
        except ValueError:
            return Response({"detail": "Invalid request token. Reload the form and try again."}, status=400)
        existing = JournalVoucher.objects.filter(client_token=token).first()
        if existing:
            # Same Save sent again (retry / double click): return the voucher already posted.
            return self._respond(existing, 200)
        on, lines = _date(request.data.get("date")), parse_rows(request.data.get("rows"))
        narration = str(request.data.get("narration") or "").strip()[:1000]
        try:
            with transaction.atomic():
                voucher = JournalVoucher.objects.create(date=on, narration=narration, client_token=token, created_by=self._user())
                JournalLine.objects.bulk_create([JournalLine(voucher=voucher, row=row, side=side, ledger=ledger, amount=amount) for row, side, ledger, amount in lines])
                JournalAudit.objects.create(voucher_id=voucher.pk, voucher_no=voucher.voucher_no, action="CREATE", after=snapshot(voucher), changed_by=self._user())
        except IntegrityError:
            existing = JournalVoucher.objects.filter(client_token=token).first()
            if existing:
                return self._respond(existing, 200)
            raise
        return self._respond(voucher, 201)

    def update(self, request, *args, **kwargs):
        with transaction.atomic():
            voucher = JournalVoucher.objects.select_for_update().get(pk=self.get_object().pk)
            before = snapshot(voucher)
            on = _date(request.data.get("date", voucher.date))
            lines = parse_rows(request.data.get("rows"), set(voucher.lines.values_list("ledger_id", flat=True))) if "rows" in request.data or not kwargs.get("partial") else None
            voucher.date = on
            if "narration" in request.data:
                voucher.narration = str(request.data.get("narration") or "").strip()[:1000]
            voucher.modified_by = self._user()
            voucher.save()
            if lines is not None:
                # Re-posting replaces the old lines in the same transaction (old postings reversed).
                voucher.lines.all().delete()
                JournalLine.objects.bulk_create([JournalLine(voucher=voucher, row=row, side=side, ledger=ledger, amount=amount) for row, side, ledger, amount in lines])
            JournalAudit.objects.create(voucher_id=voucher.pk, voucher_no=voucher.voucher_no, action="UPDATE", before=before, after=snapshot(voucher), changed_by=self._user())
        return self._respond(voucher, 200)

    def destroy(self, request, *args, **kwargs):
        with transaction.atomic():
            voucher = JournalVoucher.objects.select_for_update().get(pk=self.get_object().pk)
            JournalAudit.objects.create(voucher_id=voucher.pk, voucher_no=voucher.voucher_no, action="DELETE", before=snapshot(voucher), changed_by=self._user())
            voucher.delete()
        return Response(status=204)

    @action(detail=False, methods=["get"], url_path="next-voucher")
    def next_voucher(self, request):
        return Response({"voucher_no": JournalVoucher.next_voucher_no()})

    @action(detail=True, methods=["get"], url_path="audit")
    def audit(self, request, pk=None):
        voucher = self.get_object()
        return Response([{"action": row.get_action_display(), "changed_by": row.changed_by, "changed_at": row.changed_at, "before": row.before, "after": row.after}
                         for row in JournalAudit.objects.filter(voucher_id=voucher.pk)])
