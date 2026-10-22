from decimal import Decimal
from calendar import monthrange
from datetime import date
import json
import re
from rest_framework import serializers
from django.utils import timezone
from django.db import transaction
from .cash_bank import LedgerMappingError, is_account_ledger, resolve_account
from .models import (
    LoanType, LoanInstallment, ChitGroup, ChitGroupInstallmentDetail,
    Mortgage, MortgageUqc, CustomerLoanDetails, InterestDetails, CustomerChitDetails, MortgageLoanDetails,
    CustomerLoanInstallmentDetails, HolidayMaster, LoanHolidaySettings,
    CollectionTransaction, AdjustmentTypeMaster, MortgageRate, Ledger, PaymentEntry, Group,
    LoanKycDocument, TransactionDocument,
)
from staff.serializers import DoneBySerializerMixin
from customers.models import CustomerDocumentType
from customers.serializers import KYC_ALLOWED_CONTENT_TYPES, KYC_ALLOWED_EXTENSIONS, KYC_MAX_FILE_SIZE
from customers.kyc_security import validate_kyc_file, create_kyc_document


class AllFields(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"


class LoanTypeSerializer(DoneBySerializerMixin, AllFields):
    # The database column is NVARCHAR/TEXT, so never let DRF represent the
    # raw JSON string through ListField. This field is input-only; the parsed
    # list is added explicitly in to_representation().
    allowed_installment_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        default=list,
        write_only=True,
    )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        try:
            raw = instance.allowed_installment_ids or "[]"
            parsed = json.loads(raw) if isinstance(raw, str) else raw
            data["allowed_installment_ids"] = [int(value) for value in parsed] if isinstance(parsed, list) else []
        except (TypeError, ValueError, json.JSONDecodeError):
            data["allowed_installment_ids"] = []
        return data

    def validate_allowed_installment_ids(self, value):
        valid = set(LoanInstallment.objects.filter(id__in=value, is_active=True).values_list("id", flat=True))
        invalid = sorted(set(value) - valid)
        if invalid:
            raise serializers.ValidationError(f"Unknown or inactive installment IDs: {invalid}")
        return value

    def validate(self, attrs):
        """Default collection types may be configured, but never renamed or disabled."""
        attrs = super().validate(attrs)
        if self.instance and self.instance.name.strip().lower() in {"chit", "interest", "mortgage"}:
            if "name" in attrs and attrs["name"].strip().lower() != self.instance.name.strip().lower():
                raise serializers.ValidationError({"name": "The default loan type name cannot be changed."})
            if attrs.get("is_active") is False:
                raise serializers.ValidationError({"is_active": "Default loan types cannot be deactivated."})
            # Preserve canonical display casing even if a client submits different casing.
            canonical = {"chit": "Chit", "interest": "Interest", "mortgage": "Mortgage"}
            attrs["name"] = canonical[self.instance.name.strip().lower()]
            attrs["is_active"] = True
        return attrs

    def create(self, validated_data):
        ids = validated_data.pop("allowed_installment_ids", [])
        validated_data["allowed_installment_ids"] = json.dumps(ids, separators=(",", ":"))
        return LoanType.objects.create(**validated_data)

    def update(self, instance, validated_data):
        ids = validated_data.pop("allowed_installment_ids", None)
        for attribute, value in validated_data.items():
            setattr(instance, attribute, value)
        if ids is not None:
            instance.allowed_installment_ids = json.dumps(ids, separators=(",", ":"))
        instance.save()
        return instance

    class Meta(AllFields.Meta): model = LoanType


class LoanInstallmentSerializer(AllFields):
    class Meta(AllFields.Meta): model = LoanInstallment


class MortgageSerializer(DoneBySerializerMixin, AllFields):
    rate_date = serializers.DateField(required=False, write_only=True)
    rate_history = serializers.SerializerMethodField()

    class Meta(AllFields.Meta):
        model = Mortgage

    def get_rate_history(self, obj):
        return list(obj.rates.values("date", "rate"))

    def to_representation(self, instance):
        data = super().to_representation(instance)
        latest = instance.rates.first()
        data["rate_date"] = latest.date if latest else None
        data["uqc"] = str(instance.uqc or "").strip().upper()
        return data

    def validate(self, attrs):
        # HSN Code / Rate of Tax now belong to Group & Ledger Master; the Mortgage
        # Product form no longer sends them, so the existing columns keep their
        # saved values and are not validated here.
        for key, label in (("unit", "Unit"), ("uqc", "UQC")):
            # Require new/full form submissions, but preserve untouched legacy fields on PATCH.
            if self.instance is None or not self.partial or key in attrs:
                value = str(attrs.get(key, getattr(self.instance, key, "")) or "").strip()
                if not value:
                    raise serializers.ValidationError({key: f"{label} is required."})
                attrs[key] = value.upper() if key == "uqc" else value
        if "current_rate" in attrs and attrs["current_rate"] <= 0:
            raise serializers.ValidationError({"current_rate": "Current Rate must be greater than zero."})
        if "current_rate" in attrs and not attrs.get("rate_date"):
            raise serializers.ValidationError({"rate_date": "Date is required when setting a rate."})
        return attrs

    def _save_rate(self, instance, rate_date, rate):
        if rate_date is not None and rate is not None:
            existing, created = MortgageRate.objects.get_or_create(mortgage=instance, date=rate_date, defaults={"rate": rate})
            if not created and existing.rate != rate:
                if existing.pk != instance.rates.first().pk:
                    raise serializers.ValidationError({"rate_date": "An older rate is already saved for this date. Edit the current rate date to preserve older history."})
                existing.rate = rate
                existing.save(update_fields=("rate",))
            instance.current_rate = instance.rates.first().rate
            instance.save(update_fields=("current_rate",))
        return instance

    @transaction.atomic
    def create(self, validated_data):
        rate_date = validated_data.pop("rate_date", None)
        instance = super().create(validated_data)
        return self._save_rate(instance, rate_date, instance.current_rate)

    @transaction.atomic
    def update(self, instance, validated_data):
        rate_date = validated_data.pop("rate_date", None)
        rate = validated_data.pop("current_rate", None)
        instance = super().update(instance, validated_data)
        return self._save_rate(instance, rate_date, rate)


class ChitGroupInstallmentDetailSerializer(AllFields):
    # The parent ChitGroup is created first by ChitGroupViewSet. The FK is
    # assigned server-side, so nested create must not require it from JSON.
    group = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta(AllFields.Meta): model = ChitGroupInstallmentDetail


class ChitGroupSerializer(DoneBySerializerMixin, AllFields):
    installments = ChitGroupInstallmentDetailSerializer(many=True, required=False)
    template_installments = serializers.SerializerMethodField()
    # Keep the existing frontend field name while persisting only GrandTotal.
    total_amount = serializers.DecimalField(
        source="grand_total", max_digits=18, decimal_places=2,
        write_only=True, required=False,
    )
    grand_total = serializers.DecimalField(
        max_digits=18, decimal_places=2, read_only=True,
    )

    class Meta(AllFields.Meta):
        model = ChitGroup
        read_only_fields = ("grand_total", "template_installments")

    def get_template_installments(self, obj):
        return ChitGroupInstallmentDetailSerializer(obj.installments.all(), many=True).data

    def validate(self, attrs):
        attrs = super().validate(attrs)
        # Persist the first collection date while retaining the existing recurring rule.
        if any(key in attrs for key in ("start_date", "duration_type", "collection_day", "collection_month")):
            start = attrs.get("start_date", getattr(self.instance, "start_date", None))
            kind = attrs.get("duration_type", getattr(self.instance, "duration_type", "DAY"))
            day = int(attrs.get("collection_day", getattr(self.instance, "collection_day", 1)) or 1)
            month = int(attrs.get("collection_month", getattr(self.instance, "collection_month", 1)) or 1)
            if not 1 <= day <= 31 or not 1 <= month <= 12:
                raise serializers.ValidationError("Select a valid collection day and month.")
            if start:
                year, due_month = start.year, month if kind == "YEAR" else start.month
                due = start if kind == "DAY" else date(year, due_month, min(day, monthrange(year, due_month)[1]))
                if due < start:
                    if kind == "YEAR": year += 1
                    else:
                        due_month = due_month % 12 + 1
                        if due_month == 1: year += 1
                    due = date(year, due_month, min(day, monthrange(year, due_month)[1]))
                attrs["collection_date"] = due
            elif "start_date" in attrs:
                attrs["collection_date"] = None
        installments = attrs.get("installments")
        duration = int(attrs.get("duration", getattr(self.instance, "duration", 0)) or 0)
        total = attrs.get("grand_total", getattr(self.instance, "grand_total", Decimal("0.00")))
        if installments is None:
            return attrs
        if len(installments) != duration:
            raise serializers.ValidationError({"installments": [f"Expected {duration} installment rows, received {len(installments)}."]})
        return attrs


class CustomerLoanDetailsSerializer(DoneBySerializerMixin, AllFields):
    class Meta(AllFields.Meta):
        model = CustomerLoanDetails
        read_only_fields = ('doc_no', 'application_date')

    def to_representation(self, instance):
        from django.utils import timezone
        data = super().to_representation(instance)
        customer = instance.customer
        loan_type = instance.loan_type
        try:
            chit = instance.chit_details
        except CustomerChitDetails.DoesNotExist:
            chit = None
        try:
            interest = instance.interest_details
        except InterestDetails.DoesNotExist:
            interest = None
        try:
            mortgage = instance.mortgage_details
        except MortgageLoanDetails.DoesNotExist:
            mortgage = None
        plan = chit.chit_group if chit else None
        installments = list(instance.installment_details.all().order_by("due_date", "installment_number"))
        paid_total = sum((row.paid_amount for row in installments), Decimal("0.00"))
        total = instance.total_amount or sum((row.installment_amount for row in installments), Decimal("0.00"))
        outstanding = max(Decimal("0.00"), total - paid_total)
        today = timezone.localdate()
        unpaid = [row for row in installments if row.paid_amount < row.installment_amount]
        overdue = [row for row in unpaid if row.due_date < today]
        next_due = (overdue or unpaid)[0] if (overdue or unpaid) else None
        status = "Completed" if outstanding <= 0 and installments else "Overdue" if overdue else "Active"
        periodicity = (getattr(chit, "periodicity", "") if chit else "") or ({"DAY": "Daily", "MONTH": "Monthly", "YEAR": "Annual"}.get((plan.duration_type if plan else "").upper(), "Other"))
        schedule = [{
            "id": row.id,
            "installment_number": row.installment_number,
            "due_date": row.due_date,
            "installment_amount": row.installment_amount,
            "paid_amount": row.paid_amount,
            "balance": max(Decimal("0.00"), row.installment_amount - row.paid_amount),
            "payment_date": row.paid_date,
            "status": "Paid" if row.paid_amount >= row.installment_amount else "Overdue" if row.due_date < today else "Due",
        } for row in installments]
        data.update({
            "loan_no": instance.loan_no,
            "customer": {"id": customer.id, "code": customer.customer_code, "name": customer.full_name, "phone": customer.primary_mobile},
            "loan_type": {"id": loan_type.id, "name": loan_type.name},
            "plan": {"id": plan.id, "name": plan.name} if plan else {"id": mortgage.product_id, "name": mortgage.product_name} if mortgage else {"name": "Flat Interest" if interest else "-"},
            "interest_details": ({"principal_amount": interest.principal_amount, "interest_percentage": interest.interest_percentage, "interest_amount": interest.interest_amount, "total_payable_amount": interest.total_payable_amount, "duration_value": interest.duration_value, "duration_type": interest.duration_type, "start_date": interest.start_date, "end_date": interest.end_date, "collection_day": interest.collection_day, "collection_date": interest.collection_date, "collection_month": interest.collection_month, "installment_count": interest.installment_count, "installment_amount": interest.installment_amount, "periodicity": interest.loan_installment.name} if interest else None),
            "mortgage_details": ({"product": mortgage.product_id, "product_name": mortgage.product_name, "unit": mortgage.unit, "quantity": mortgage.quantity, "current_rate": mortgage.current_rate, "market_value": mortgage.market_value, "loan_amount": mortgage.loan_amount, "interest_percentage": mortgage.interest_percentage, "daily_interest_amount": mortgage.daily_interest_amount} if mortgage else None),
            "periodicity": {"name": periodicity},
            "include_sunday": bool(chit.include_sunday) if chit else False,
            "start_date": instance.loan_start_date,
            "end_date": instance.loan_end_date,
            "total_amount": total,
            "collected_amount": paid_total,
            "outstanding_amount": outstanding,
            "total_installments": len(installments),
            "paid_installments": sum(1 for row in installments if row.paid_amount >= row.installment_amount),
            "next_due_date": next_due.due_date if next_due else None,
            "next_due_amount": max(Decimal("0.00"), next_due.installment_amount - next_due.paid_amount) if next_due else Decimal("0.00"),
            "status": status,
            "installments": schedule,
        })
        return data


class InterestDetailsSerializer(AllFields):
    class Meta(AllFields.Meta): model = InterestDetails


class CustomerChitDetailsSerializer(AllFields):
    class Meta(AllFields.Meta): model = CustomerChitDetails


class CustomerLoanInstallmentDetailsSerializer(AllFields):
    due_amount = serializers.SerializerMethodField()
    total_paid = serializers.SerializerMethodField()
    balance = serializers.SerializerMethodField()
    payment_status_display = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()
    days_overdue = serializers.SerializerMethodField()

    def _paid(self, obj):
        total = obj.collection_transactions.aggregate(total=__import__("django.db.models", fromlist=["Sum"]).Sum("collection_amount"))["total"]
        return total if total is not None else obj.paid_amount

    def get_due_amount(self, obj): return obj.installment_amount
    def get_total_paid(self, obj): return self._paid(obj)
    def get_balance(self, obj): return max(Decimal("0.00"), obj.installment_amount + obj.penalty_amount - self._paid(obj))
    def get_payment_status_display(self, obj):
        balance = self.get_balance(obj); paid = self._paid(obj)
        return "PAID" if balance <= 0 else "PARTIAL" if paid > 0 else "PENDING"
    def get_is_overdue(self, obj): return obj.due_date < timezone.localdate() and self.get_balance(obj) > 0
    def get_days_overdue(self, obj): return max(0, (timezone.localdate() - obj.due_date).days) if self.get_is_overdue(obj) else 0

    class Meta(AllFields.Meta): model = CustomerLoanInstallmentDetails


class HolidayMasterSerializer(DoneBySerializerMixin, AllFields):
    allocations = serializers.SerializerMethodField()

    def get_allocations(self, obj):
        return list(LoanHolidaySettings.objects.filter(holiday=obj, include_in_schedule=True).values("id", "loan_id", "loan__loan_no"))

    class Meta(AllFields.Meta): model = HolidayMaster

    def validate_holiday_type(self, value):
        value = str(value or "").strip().upper()
        if value not in HolidayMaster.TYPES:
            raise serializers.ValidationError("Select a valid Holiday Type.")
        return value

    def validate_holiday_name(self, value):
        value = str(value or "").strip()
        if not value:
            raise serializers.ValidationError("Reason / Description is required.")
        return value

    def validate(self, attrs):
        day = attrs.get("holiday_date", getattr(self.instance, "holiday_date", None))
        kind = attrs.get("holiday_type", getattr(self.instance, "holiday_type", ""))
        if kind == HolidayMaster.SUNDAY_WORKING and day and day.weekday() != 6:
            raise serializers.ValidationError({"holiday_type": "Only a Sunday can be marked as a Working Sunday."})
        return attrs


class AdjustmentTypeMasterSerializer(AllFields):
    class Meta(AllFields.Meta): model = AdjustmentTypeMaster


class LoanHolidaySettingsSerializer(AllFields):
    class Meta(AllFields.Meta): model = LoanHolidaySettings


class LedgerSerializer(DoneBySerializerMixin, AllFields):
    # Not required at the field level: the new hierarchical Group dropdown
    # sends group_detail instead, and validate() derives this legacy string
    # from it. Older/API callers may still post `group` directly.
    group = serializers.ChoiceField(choices=Ledger.GROUPS, required=False)
    # Display-only name of the Group_tbl node; group_detail (the id) stays the saved FK.
    group_detail_name = serializers.CharField(source="group_detail.name", read_only=True, default=None)
    # Customer ID <-> Ledger ID link: set only by Customer Master (finance.signals), never by
    # this API, so a ledger can never be re-pointed at another customer.
    customer_name = serializers.CharField(source="customer.full_name", read_only=True, default=None)

    class Meta(AllFields.Meta):
        model = Ledger
        read_only_fields = ('created_by', 'modified_by', 'customer')

    def validate_name(self, value):
        value = " ".join(value.strip().split())
        if not value:
            raise serializers.ValidationError('Name is required.')
        # Customer Name = Party Ledger Name, so a linked ledger follows the customer name rules.
        if self.instance is not None and self.instance.customer_id and (len(value) < 2 or not re.fullmatch(r"[A-Za-z .'-]+", value)):
            raise serializers.ValidationError("This ledger is linked to a customer: enter a valid name with at least 2 letters.")
        return value

    def update(self, instance, validated_data):
        ledger = super().update(instance, validated_data)
        if ledger.customer_id:
            # Two-way binding: the linked customer keeps the ledger's name and group.
            from customers.models import Customer
            from customers.serializers import ROLE_BY_ROOT_NAME
            changes = {"full_name": ledger.name}
            if ledger.group_detail_id:
                changes["group_id"] = ledger.group_detail_id
                role = ROLE_BY_ROOT_NAME.get(ledger.group)
                if role:
                    changes["role"] = role
            Customer.objects.filter(pk=ledger.customer_id).update(**changes)
        return ledger

    def validate_hsn_code(self, value):
        return str(value or "").strip()

    def validate(self, attrs):
        # group_detail (the precise Group_tbl node chosen in the UI) is the
        # source of truth when present; `group` (legacy root-name string) is
        # derived from it so existing cash/bank balance reports and signals
        # keep working. Callers that still post `group` directly (no
        # group_detail) keep working exactly as before.
        group_detail = attrs.get("group_detail", getattr(self.instance, "group_detail", None))
        if group_detail is not None:
            attrs["group"] = group_detail.root().name
        elif not attrs.get("group", getattr(self.instance, "group", None)):
            raise serializers.ValidationError({"group": "Group is required."})
        if self.instance is not None and self.instance.customer_id and attrs.get("group", self.instance.group) not in (Ledger.DEBTORS_GROUP, "Sundry Creditors"):
            raise serializers.ValidationError({"group": "This ledger is linked to a customer: keep it under Sundry Debtors or Sundry Creditors."})
        self._validate_single_cash_ledger(attrs)
        self._validate_bank_details(attrs)
        self._clear_tax_details(attrs, group_detail)
        # Collection Type (Party Collection) belongs only to Sundry Debtors ledgers.
        if attrs.get("group", getattr(self.instance, "group", None)) != Ledger.DEBTORS_GROUP:
            attrs["collection_type"] = ""
        return attrs

    def _validate_single_cash_ledger(self, attrs):
        # Only one Cash in Hand ledger may exist (Cash mode always posts to it);
        # any number of Bank Accounts ledgers are allowed.
        # An existing Cash in Hand ledger can still be edited.
        if attrs.get("group", getattr(self.instance, "group", None)) != Ledger.CASH_GROUP:
            return
        if self.instance is not None and self.instance.group == Ledger.CASH_GROUP:
            return
        others = Ledger.objects.filter(group=Ledger.CASH_GROUP)
        if self.instance:
            others = others.exclude(pk=self.instance.pk)
        if others.exists():
            raise serializers.ValidationError({"group": "A Cash in Hand ledger already exists. Only one Cash in Hand ledger is allowed."})

    def _clear_tax_details(self, attrs, group_detail):
        # HSN Code / Rate of Tax apply only to Income and Expense ledgers; every
        # other category is saved without them.
        if group_detail is not None:
            taxable = group_detail.root().nature in Ledger.TAXABLE_NATURES
        else:
            taxable = attrs.get("group", getattr(self.instance, "group", None)) in Ledger.TAXABLE_GROUPS
        if not taxable:
            attrs["hsn_code"], attrs["rate_of_tax"] = "", 0

    def _validate_bank_details(self, attrs):
        # Bank Name / Branch / IFSC / Account Number belong only to ledgers whose
        # group resolves to the "Bank Accounts" root. They are required there and
        # cleared for every other group, so a ledger moved out of Bank Accounts
        # never keeps stale bank details.
        group = attrs.get("group", getattr(self.instance, "group", None))
        if group != Ledger.BANK_GROUP:
            for field in Ledger.BANK_FIELDS:
                attrs[field] = ""
            return
        # A partial update that touches neither the group nor any bank field
        # (e.g. renaming a legacy bank ledger) is left alone.
        sent = getattr(self, "initial_data", None) or {}
        if self.partial and not any(key in sent for key in (*Ledger.BANK_FIELDS, "group", "group_detail")):
            return
        values = {field: str(attrs.get(field, getattr(self.instance, field, "")) or "").strip() for field in Ledger.BANK_FIELDS}
        values["ifsc_code"] = values["ifsc_code"].upper()
        values["account_number"] = re.sub(r"\s+", "", values["account_number"])
        labels = {"bank_name": "Bank Name", "branch_name": "Branch Name", "ifsc_code": "IFSC Code", "account_number": "Account Number"}
        errors = {field: f"{labels[field]} is required." for field, value in values.items() if not value}
        if values["ifsc_code"] and "ifsc_code" not in errors and not re.fullmatch(r"[A-Z]{4}0[A-Z0-9]{6}", values["ifsc_code"]):
            errors["ifsc_code"] = "Enter a valid 11-character IFSC Code (e.g. SBIN0001234)."
        if values["account_number"] and "account_number" not in errors and not re.fullmatch(r"\d{9,18}", values["account_number"]):
            errors["account_number"] = "Account Number must be 9 to 18 digits."
        if errors:
            raise serializers.ValidationError(errors)
        attrs.update(values)


class GroupSerializer(DoneBySerializerMixin, AllFields):
    # The client works with IDs only; parent_group_id is the single source of
    # truth for the hierarchy link (never the parent's display name), and
    # group_name/parent_group_id mirror the Group_tbl column names so other
    # modules (e.g. Ledger) can bind to the same shape later.
    group_name = serializers.CharField(source="name", max_length=150)
    parent_group_id = serializers.PrimaryKeyRelatedField(source="parent", queryset=Group.objects.all(), required=False, allow_null=True, default=None)

    class Meta(AllFields.Meta):
        model = Group
        fields = ("id", "group_name", "parent_group_id", "is_system", "is_active", "nature", "hsn_code", "rate_of_tax", "unit", "uqc", "done_by_staff", "done_by_staff_name", "created_by", "create_date", "modified_by", "modified_date")
        read_only_fields = ("is_system", "created_by", "create_date", "modified_by", "modified_date")

    def validate_group_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Group Name is required.")
        return value

    def validate_hsn_code(self, value):
        return str(value or "").strip()

    def validate_unit(self, value):
        return str(value or "").strip()

    def validate_uqc(self, value):
        return str(value or "").strip().upper()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["uqc"] = str(instance.uqc or "").strip().upper()
        return data

    def validate(self, attrs):
        name = attrs.get("name", getattr(self.instance, "name", ""))
        parent = attrs.get("parent", getattr(self.instance, "parent", None))
        duplicates = Group.objects.filter(parent=parent, name__iexact=name)
        if self.instance:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError({"group_name": "A group with this name already exists under the selected Group Tag."})
        if self.instance and parent is not None:
            node = parent
            while node is not None:
                if node.pk == self.instance.pk:
                    raise serializers.ValidationError({"parent_group_id": "A group cannot be moved under itself or one of its own sub-groups."})
                node = node.parent
        # HSN Code / Rate of Tax belong only to groups under an Income or Expense root (Direct /
        # Indirect Expenses, Direct / Indirect Income), resolved from the Group Tag's root nature;
        # every other group is saved without them (same rule as Ledger Master).
        root = parent.root() if parent is not None else self.instance
        if root is not None and root.nature not in Ledger.TAXABLE_NATURES:
            attrs["hsn_code"], attrs["rate_of_tax"] = "", 0
        return attrs


class PaymentEntrySerializer(DoneBySerializerMixin, AllFields):
    ledger_name = serializers.CharField(source='ledger.name', read_only=True, default=None)
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)

    ledger_group = serializers.CharField(required=False, allow_blank=True, max_length=30)

    class Meta(AllFields.Meta):
        model = PaymentEntry
        read_only_fields = ('created_by', 'modified_by')

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        return value

    def validate(self, attrs):
        mode = attrs.get('payment_mode', getattr(self.instance, 'payment_mode', None))
        # Payment Entry: UPI needs only the UTR / transaction reference (the UPI ID is optional).
        required = {'UPI': ('transaction_utr',), 'Cheque': ('cheque_number', 'cheque_date', 'bank_name'),
                    'NEFT': ('transaction_utr', 'bank_name'), 'RTGS': ('transaction_utr', 'bank_name'),
                    'IMPS': ('transaction_utr', 'bank_name')}.get(mode, ())
        errors = {key: 'This field is required.' for key in required
                  if not attrs.get(key, getattr(self.instance, key, None))}
        current = lambda key: attrs.get(key, getattr(self.instance, key, None))
        if not current('ledger') and not current('ledger_group'):
            errors['ledger_group'] = 'Select a Ledger.'
        # Cash/Bank side follows the Payment Mode: Cash -> default Cash-in-Hand ledger,
        # other modes -> the selected Bank Accounts ledger (required).
        if mode not in dict(PaymentEntry.PAYMENT_MODES):
            errors['payment_mode'] = 'Select a Payment Mode.'
        else:
            try:
                attrs['account'] = resolve_account(mode, attrs.get('account'), getattr(self.instance, 'account', None))
            except LedgerMappingError as error:
                errors[error.field] = error.message
        if 'ledger' in attrs and is_account_ledger(attrs['ledger']):
            errors['ledger'] = 'Cash in Hand and Bank Accounts belong in Accounts, not Ledger.'
        if current('ledger'):
            attrs['ledger_group'] = current('ledger').group
        elif current('ledger_group') and current('ledger_group') not in dict(PaymentEntry.LEDGER_GROUPS):
            errors['ledger_group'] = 'Select a valid Ledger.'
        loan = current('loan')
        if loan and (not current('ledger') or current('ledger').customer_id != loan.customer_id):
            errors['loan'] = 'Loan Plan does not belong to the selected Ledger.'
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class LoanKycDocumentSerializer(serializers.ModelSerializer):
    upload_token = serializers.UUIDField(required=False, allow_null=True, write_only=True)
    """Mirrors CustomerKycDocumentSerializer (Phase 8) exactly — same file
    validation, same OTHER-requires-a-name rule, same CustomerDocumentType
    upsert-on-success — just scoped to a loan instead of a customer."""
    document_type_display = serializers.CharField(source="get_document_type_display", read_only=True)
    file = serializers.FileField(write_only=True)

    class Meta:
        model = LoanKycDocument
        # "loan" is deliberately excluded: the view always supplies it from the URL
        # (serializer.save(loan=loan)), never from the request body.
        fields = ("id", "document_type", "document_type_display", "other_document_name",
                   "file", "upload_token", "original_file_name", "file_type", "file_size", "created_at")
        read_only_fields = ("id", "original_file_name", "file_type", "file_size", "created_at")

    def validate_file(self, value):
        return validate_kyc_file(value)

    def validate(self, attrs):
        document_type = attrs.get("document_type", getattr(self.instance, "document_type", ""))
        other_name = attrs.get("other_document_name", getattr(self.instance, "other_document_name", ""))
        if document_type == LoanKycDocument.DocumentType.OTHER and not str(other_name).strip():
            raise serializers.ValidationError({"other_document_name": "Document Name is required for 'Other'."})
        if document_type != LoanKycDocument.DocumentType.OTHER:
            attrs["other_document_name"] = ""
        return attrs

    def create(self, validated_data):
        return create_kyc_document(LoanKycDocument, validated_data)


class TransactionDocumentSerializer(LoanKycDocumentSerializer):
    """Same validation, OTHER-name rule and retry-safe upload_token handling as loan KYC
    documents. The owning receipt/payment is never read from the body — the view supplies it."""

    class Meta(LoanKycDocumentSerializer.Meta):
        model = TransactionDocument

    def create(self, validated_data):
        return create_kyc_document(TransactionDocument, validated_data)
