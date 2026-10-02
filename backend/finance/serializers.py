from decimal import Decimal
from calendar import monthrange
from datetime import date
import json
from rest_framework import serializers
from django.utils import timezone
from django.db import transaction
from .models import (
    LoanType, LoanInstallment, ChitGroup, ChitGroupInstallmentDetail,
    Mortgage, CustomerLoanDetails, InterestDetails, CustomerChitDetails, MortgageLoanDetails,
    CustomerLoanInstallmentDetails, HolidayMaster, LoanHolidaySettings,
    CollectionTransaction, AdjustmentTypeMaster, MortgageRate, Ledger, PaymentEntry, Group,
)


class AllFields(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"


class LoanTypeSerializer(AllFields):
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


class MortgageSerializer(AllFields):
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
        return data

    def validate(self, attrs):
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


class ChitGroupSerializer(AllFields):
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


class CustomerLoanDetailsSerializer(AllFields):
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


class HolidayMasterSerializer(AllFields):
    class Meta(AllFields.Meta): model = HolidayMaster


class AdjustmentTypeMasterSerializer(AllFields):
    class Meta(AllFields.Meta): model = AdjustmentTypeMaster


class LoanHolidaySettingsSerializer(AllFields):
    class Meta(AllFields.Meta): model = LoanHolidaySettings


class LedgerSerializer(AllFields):
    class Meta(AllFields.Meta):
        model = Ledger
        read_only_fields = ('created_by', 'modified_by')

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Name is required.')
        return value


class GroupSerializer(AllFields):
    # The client works with IDs only; parent_group_id is the single source of
    # truth for the hierarchy link (never the parent's display name), and
    # group_name/parent_group_id mirror the Group_tbl column names so other
    # modules (e.g. Ledger) can bind to the same shape later.
    group_name = serializers.CharField(source="name", max_length=150)
    parent_group_id = serializers.PrimaryKeyRelatedField(source="parent", queryset=Group.objects.all(), required=False, allow_null=True, default=None)

    class Meta(AllFields.Meta):
        model = Group
        fields = ("id", "group_name", "parent_group_id", "is_system", "is_active", "created_by", "create_date", "modified_by", "modified_date")
        read_only_fields = ("is_system", "created_by", "create_date", "modified_by", "modified_date")

    def validate_group_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Group Name is required.")
        return value

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
        return attrs


class PaymentEntrySerializer(AllFields):
    ledger_name = serializers.CharField(source='ledger.name', read_only=True, default=None)
    account_name = serializers.CharField(source='account.name', read_only=True, default=None)

    class Meta(AllFields.Meta):
        model = PaymentEntry
        read_only_fields = ('created_by', 'modified_by')

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        return value

    def validate(self, attrs):
        mode = attrs.get('payment_mode', getattr(self.instance, 'payment_mode', None))
        required = {'UPI': ('upi_id', 'transaction_utr'), 'Cheque': ('cheque_number', 'cheque_date', 'bank_name'),
                    'NEFT': ('transaction_utr', 'bank_name')}.get(mode, ())
        errors = {key: 'This field is required.' for key in required
                  if not attrs.get(key, getattr(self.instance, key, None))}
        current = lambda key: attrs.get(key, getattr(self.instance, key, None))
        if not current('ledger') and not current('ledger_group'):
            errors['ledger_group'] = 'Select a Ledger.'
        if not current('accounts') and not current('account'):
            errors['account'] = 'Select an Account.'
        account = attrs.get('account')
        if account is not None and account.group not in PaymentEntry.ACCOUNT_GROUPS:
            errors['account'] = 'Select a Cash or Bank account.'
        if errors:
            raise serializers.ValidationError(errors)
        return attrs
