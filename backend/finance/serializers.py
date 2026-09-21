from decimal import Decimal
import json
from rest_framework import serializers
from django.utils import timezone
from .models import (
    LoanType, LoanInstallment, ChitGroup, ChitGroupInstallmentDetail,
    CustomerLoanDetails, InterestDetails, CustomerChitDetails,
    CustomerLoanInstallmentDetails, HolidayMaster, LoanHolidaySettings,
    CollectionTransaction, AdjustmentTypeMaster,
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
        installments = attrs.get("installments")
        duration = int(attrs.get("duration", getattr(self.instance, "duration", 0)) or 0)
        total = attrs.get("grand_total", getattr(self.instance, "grand_total", Decimal("0.00")))
        if installments is None:
            return attrs
        if len(installments) != duration:
            raise serializers.ValidationError({"installments": [f"Expected {duration} installment rows, received {len(installments)}."]})
        total_paise = int((Decimal(str(total)) * 100).quantize(Decimal("1")))
        rows_paise = sum(int((Decimal(str(item.get("installment_amount", 0))) * 100).quantize(Decimal("1"))) for item in installments)
        if rows_paise != total_paise:
            raise serializers.ValidationError({"installments": [f"Installment total {rows_paise / 100:.2f} does not equal Total Amount {total_paise / 100:.2f}."]})
        return attrs


class CustomerLoanDetailsSerializer(AllFields):
    class Meta(AllFields.Meta): model = CustomerLoanDetails

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
            "plan": {"id": plan.id, "name": plan.name} if plan else {"name": "Flat Interest" if interest else "-"},
            "interest_details": ({"principal_amount": interest.principal_amount, "interest_percentage": interest.interest_percentage, "interest_amount": interest.interest_amount, "total_payable_amount": interest.total_payable_amount, "duration_value": interest.duration_value, "start_date": interest.start_date, "end_date": interest.end_date, "collection_day": interest.collection_day, "collection_date": interest.collection_date, "collection_month": interest.collection_month, "installment_count": interest.installment_count, "installment_amount": interest.installment_amount, "periodicity": interest.loan_installment.name} if interest else None),
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
