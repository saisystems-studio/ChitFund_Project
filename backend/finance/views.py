from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
import logging
import re
from django.db import transaction
from django.db.models import Q, Sum, F, Exists, OuterRef, Count, Prefetch
from django.db.models import ProtectedError
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.pagination import PageNumberPagination
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from customers.kyc_security import CanAccessKycDocuments, secure_kyc_response
from accounts.permissions import CanWriteFinanceData, IsAdminRole
from .cash_bank import BANK_GROUP, CASH_GROUP, LedgerMappingError, customer_ledger, is_account_ledger, is_cash_mode, resolve_account
from .models import (LoanType, LoanInstallment, ChitGroup, ChitGroupInstallmentDetail,
    Mortgage, MortgageUnit, MortgageProductGroup, MortgageUqc, MortgageRate, CustomerLoanDetails, InterestDetails, CustomerChitDetails, MortgageLoanDetails,
    CustomerLoanInstallmentDetails, HolidayMaster, LoanHolidaySettings, CollectionTransaction, AdjustmentTypeMaster,
    Ledger, PaymentEntry, MortgageLoanHistory, CollectionAllocation, Group, LoanKycDocument, TransactionDocument)
from .delete_utils import delete_response
from .receipts import voucher_no as receipt_voucher_no
from .serializers import (LoanTypeSerializer, LoanInstallmentSerializer, ChitGroupSerializer,
    ChitGroupInstallmentDetailSerializer, MortgageSerializer, CustomerLoanDetailsSerializer, InterestDetailsSerializer,
    CustomerChitDetailsSerializer, CustomerLoanInstallmentDetailsSerializer,
    HolidayMasterSerializer, LoanHolidaySettingsSerializer, AdjustmentTypeMasterSerializer, LedgerSerializer, PaymentEntrySerializer,
    GroupSerializer, LoanKycDocumentSerializer, TransactionDocumentSerializer)
from .services import calendar_blocked_dates, generate_chit_schedule, generate_customer_chit_installments, generate_customer_interest_installments, generate_customer_mortgage_installment, record_mortgage_history

logger = logging.getLogger(__name__)


@api_view(['GET'])
def mortgage_report(request):
    rows = MortgageLoanHistory.objects.all()
    search = request.query_params.get('search', '').strip()
    if search:
        rows = rows.filter(Q(doc_no__icontains=search) | Q(customer_name__icontains=search))
    try:
        if request.query_params.get('from'):
            rows = rows.filter(recorded_at__date__gte=date.fromisoformat(request.query_params['from']))
        if request.query_params.get('to'):
            rows = rows.filter(recorded_at__date__lte=date.fromisoformat(request.query_params['to']))
    except ValueError:
        return Response({'detail': 'Enter valid report dates.'}, status=400)
    results = list(rows.values('id', 'loan_id', 'doc_no', 'customer_name', 'action', 'recorded_at', 'recorded_by', 'snapshot'))
    return Response({'count': len(results), 'results': results})


class FinancePagination(PageNumberPagination):
    page_size_query_param = "page_size"
    max_page_size = 10000


class FinanceViewSet(viewsets.ModelViewSet):
    permission_classes = [CanWriteFinanceData]
    pagination_class = FinancePagination

    delete_label = "record"

    def destroy(self, request, *args, **kwargs):
        return delete_response(self.get_object(), self.delete_label)


class LedgerViewSet(FinanceViewSet):
    queryset = Ledger.objects.select_related("group_detail", "done_by_staff", "customer").all()
    serializer_class = LedgerSerializer
    delete_label = "ledger"
    pagination_class = None
    search_fields = ('name', 'group')

    def destroy(self, request, *args, **kwargs):
        item = self.get_object()
        # A linked Party Ledger lives and dies with its customer (one ledger per customer).
        if item.customer_id:
            return Response({"detail": "This ledger is linked to a customer. Delete or edit the customer in Customer Master instead."}, status=409)
        return super().destroy(request, *args, **kwargs)


class GroupViewSet(FinanceViewSet):
    pagination_class = None
    queryset = Group.objects.select_related("done_by_staff").all()
    serializer_class = GroupSerializer
    delete_label = "group"

    def get_queryset(self):
        return super().get_queryset().order_by("name", "id")

    def destroy(self, request, *args, **kwargs):
        item = self.get_object()
        if item.is_system:
            return Response({"detail": "This root group is a system default and cannot be deleted."}, status=400)
        # Ledger.group_detail is SET_NULL, so deleting a group that ledgers use would silently
        # unlink them from their accounting group; block it like any other protected record.
        ledger_count = item.ledgers_detail.count()
        if ledger_count:
            noun = "ledger" if ledger_count == 1 else "ledgers"
            return Response({"detail": f"This group cannot be deleted because it is used in {ledger_count} {noun}."}, status=409)
        return delete_response(item, self.delete_label)


class PaymentEntryViewSet(FinanceViewSet):
    queryset = PaymentEntry.objects.select_related('ledger')
    serializer_class = PaymentEntrySerializer
    delete_label = "payment entry"
    search_fields = ('ledger__name',)


@api_view(["GET", "POST"])
@permission_classes([CanWriteFinanceData])
def adjustment_types(request):
    if request.method == "GET":
        return Response(AdjustmentTypeMasterSerializer(AdjustmentTypeMaster.objects.filter(is_active=True), many=True).data)
    name = str(request.data.get("name", "")).strip()
    if not name:
        return Response({"detail": "Adjustment type is required."}, status=400)
    existing = AdjustmentTypeMaster.objects.filter(name__iexact=name).first()
    if existing:
        return Response(AdjustmentTypeMasterSerializer(existing).data)
    item = AdjustmentTypeMaster.objects.create(name=name)
    return Response(AdjustmentTypeMasterSerializer(item).data, status=201)


class LoanTypeViewSet(FinanceViewSet):
    pagination_class = None
    queryset = LoanType.objects.select_related("done_by_staff").all(); serializer_class = LoanTypeSerializer

    @staticmethod
    def _ensure_defaults():
        # Seed only the two protected defaults; existing custom types are untouched.
        for name in ("Chit", "Interest", "Mortgage"):
            item = LoanType.objects.filter(name__iexact=name).order_by("id").first()
            if item is None:
                LoanType.objects.create(name=name, is_active=True)
            elif not item.is_active or item.name != name:
                item.name = name
                item.is_active = True
                item.save(update_fields=("name", "is_active"))

    def get_queryset(self):
        self._ensure_defaults()
        # Selection requests expose usable master records; deletion removes records permanently.
        if self.request.query_params.get("include_inactive") == "true" or self.action != "list":
            return LoanType.objects.select_related("done_by_staff").all()
        return LoanType.objects.select_related("done_by_staff").filter(is_active=True, name__in=("Chit", "Interest", "Mortgage"))

    def create(self, request, *args, **kwargs):
        return Response({"detail": "Only the fixed Chit, Interest and Mortgage loan types are available."}, status=405)

    def destroy(self, request, *args, **kwargs):
        item = self.get_object()
        if item.name.strip().lower() in {"chit", "interest", "mortgage"}:
            return Response({"detail": "Default loan types cannot be deleted."}, status=400)
        return delete_response(item, "loan type")

class LoanInstallmentViewSet(FinanceViewSet):
    delete_label = "collection type"
    pagination_class = None
    queryset = LoanInstallment.objects.all(); serializer_class = LoanInstallmentSerializer


class MortgageViewSet(FinanceViewSet):
    pagination_class = None
    queryset = Mortgage.objects.select_related("done_by_staff").all()
    serializer_class = MortgageSerializer

    @action(detail=False, methods=["get", "post"], url_path="uqcs")
    def uqcs(self, request):
        defaults = {"KGS", "LTR", "NOS", "PCS", "MTR", "BOX", "GMS", "BAG", "BTL", "CAN", "CMS", "DOZ", "DZN", "FTS", "KLR", "MLT", "MTR", "OTH", "PAC", "PRS", "QTL", "SET", "SQF", "SQM", "TBS", "TGM", "THD", "TON", "UNT", "YDS"}
        if request.method == "GET":
            names = defaults | set(MortgageUqc.objects.values_list("name", flat=True))
            names.update(Mortgage.objects.exclude(uqc="").values_list("uqc", flat=True))
            return Response(sorted({name.strip().upper() for name in names if name and name.strip()}, key=str.casefold))
        name = str(request.data.get("name", "") or "").strip().upper()
        if not name or len(name) > 20 or name in {"OTHER", "__OTHER__"}:
            return Response({"detail": "Enter a UQC of 1-20 characters other than Other."}, status=400)
        existing = MortgageUqc.objects.filter(name__iexact=name).first()
        if existing:
            item, created = existing, False
        else:
            item, created = MortgageUqc.objects.get_or_create(name=name)
        return Response({"name": item.name.strip().upper()}, status=201 if created else 200)

    @action(detail=False, methods=["get", "post"])
    def units(self, request):
        if request.method == "GET":
            names = {"Gram", "No", "Pcs"}
            names.update(MortgageUnit.objects.values_list("name", flat=True))
            names.update(Mortgage.objects.exclude(unit="").values_list("unit", flat=True))
            return Response(sorted(names, key=str.casefold))
        name = str(request.data.get("name", "")).strip()
        if not name or len(name) > 50 or name.casefold() == "other":
            return Response({"detail": "Enter a unit name of 1â€“50 characters other than Other."}, status=400)
        existing = MortgageUnit.objects.filter(name__iexact=name).first()
        item = existing or MortgageUnit.objects.get_or_create(name=name)[0]
        return Response({"name": item.name}, status=200 if existing else 201)

    @action(detail=False, methods=["get", "post"], url_path="product-groups")
    def product_groups(self, request):
        if request.method == "GET":
            names = set(MortgageProductGroup.objects.values_list("name", flat=True))
            names.update(Mortgage.objects.exclude(product_group="").values_list("product_group", flat=True))
            return Response(sorted(names, key=str.casefold))
        name = str(request.data.get("name", "")).strip()
        if not name or len(name) > 50 or name.casefold() == "other":
            return Response({"detail": "Enter a product group name of 1â€“50 characters other than Other."}, status=400)
        existing = MortgageProductGroup.objects.filter(name__iexact=name).first()
        item = existing or MortgageProductGroup.objects.get_or_create(name=name)[0]
        return Response({"name": item.name}, status=200 if existing else 201)

    @action(detail=False, methods=["get"])
    def rate_history(self, request):
        rows = MortgageRate.objects.select_related("mortgage").order_by("-date", "-id")
        search = request.query_params.get("search", "").strip()
        if search:
            rows = rows.filter(mortgage__product_name__icontains=search)
        results = [{"id": row.id, "product_name": row.mortgage.product_name, "date": row.date, "rate": row.rate} for row in rows]
        return Response(results)

    def get_queryset(self):
        queryset = super().get_queryset()
        search = self.request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(Q(product_name__icontains=search) | Q(unit__icontains=search))
        return queryset.filter(is_active=True) if self.action == "list" else queryset

    delete_label = "mortgage product"


class ChitGroupViewSet(FinanceViewSet):
    pagination_class = None
    queryset = ChitGroup.objects.select_related("done_by_staff").prefetch_related("installments"); serializer_class = ChitGroupSerializer

    def get_queryset(self):
        # Active groups first; deactivated groups stay listed at the bottom.
        return super().get_queryset().order_by("-is_active", "id")

    delete_label = "chit group"

    @transaction.atomic
    def perform_create(self, serializer):
        rows = serializer.validated_data.pop("installments", [])
        # Codes must be generated from the highest existing suffix, not the
        # number of rows. Deleted/non-sequential groups must never reuse a code.
        group = serializer.save(code=self._next_code())
        self._save_rows(group, rows)

    def _next_code(self):
        highest = 0
        for value in ChitGroup.objects.values_list("code", flat=True):
            match = re.fullmatch(r"CHG_(\d+)", str(value or "").strip().upper())
            if match:
                highest = max(highest, int(match.group(1)))
        return f"CHG_{highest + 1:03d}"

    @transaction.atomic
    def perform_update(self, serializer):
        rows = serializer.validated_data.pop("installments", None)
        group = serializer.save()
        if rows is not None: self._save_rows(group, rows)

    def _save_rows(self, group, rows):
        if len(rows) != int(group.duration or 0):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"installments": [f"Expected {group.duration} installment rows, received {len(rows)}."]})
        ChitGroupInstallmentDetail.objects.filter(group=group).delete()
        created = ChitGroupInstallmentDetail.objects.bulk_create([
            ChitGroupInstallmentDetail(group=group, installment_number=index + 1,
                schedule_value=item.get("schedule_value", str(index + 1)),
                installment_amount=item.get("installment_amount", 0))
            for index, item in enumerate(rows)
        ])
        # Keep the entered Chit Amount; only fall back to the schedule sum when none was given.
        if not group.grand_total:
            from decimal import Decimal
            group.grand_total = sum((row.installment_amount for row in created), Decimal("0.00"))
            group.save(update_fields=("grand_total", "modified_date"))


class ChitGroupInstallmentDetailViewSet(FinanceViewSet):
    queryset = ChitGroupInstallmentDetail.objects.all(); serializer_class = ChitGroupInstallmentDetailSerializer


class CustomerLoanDetailsViewSet(FinanceViewSet):
    queryset = CustomerLoanDetails.objects.select_related("customer", "loan_type", "chit_details__chit_group", "interest_details", "mortgage_details__product").prefetch_related("installment_details"); serializer_class = CustomerLoanDetailsSerializer
    delete_label = "loan"

    def get_permissions(self):
        # Regenerating an existing loan's schedule overwrites already-persisted
        # installment rows â€” that is an edit, not an Entry, so it is admin-only
        # regardless of the normal POST-is-Entry rule below.
        if self.action == "generate_customer_schedule":
            return [IsAdminRole()]
        return super().get_permissions()

    @action(detail=False, methods=['get'], url_path='application-date')
    def application_date(self, request):
        return Response({'application_date': timezone.localdate()})

    def get_queryset(self):
        queryset = super().get_queryset()
        customer = self.request.query_params.get("customer")
        if customer:
            queryset = queryset.filter(customer_id=customer)
        if self.action == "list":
            status_filter = self.request.query_params.get('status', '').upper()
            # Preserve the default active-only behavior for existing consumers.
            if status_filter not in ('ALL', 'COMPLETED'):
                queryset = queryset.filter(is_active=True)
            kind = self.request.query_params.get('loan_type', '')
            if kind and kind.upper() != 'ALL':
                queryset = queryset.filter(loan_type__name__iexact=kind)
            search = self.request.query_params.get('search', '').strip()
            if search:
                queryset = queryset.filter(Q(doc_no__icontains=search) | Q(loan_no__icontains=search)
                    | Q(customer__full_name__icontains=search) | Q(customer__customer_code__icontains=search)
                    | Q(customer__primary_mobile__icontains=search))
            if status_filter and status_filter != 'ALL':
                unpaid = CustomerLoanInstallmentDetails.objects.filter(loan_id=OuterRef('pk'), paid_amount__lt=F('installment_amount'))
                queryset = queryset.annotate(has_unpaid=Exists(unpaid), has_overdue=Exists(unpaid.filter(due_date__lt=timezone.localdate())),
                    has_schedule=Exists(CustomerLoanInstallmentDetails.objects.filter(loan_id=OuterRef('pk'))))
                if status_filter == 'COMPLETED':
                    queryset = queryset.filter(has_schedule=True, has_unpaid=False)
                elif status_filter == 'OVERDUE':
                    queryset = queryset.filter(has_overdue=True)
                elif status_filter in ('ACTIVE', 'PENDING'):
                    queryset = queryset.filter(has_overdue=False).exclude(has_schedule=True, has_unpaid=False)
                else:
                    queryset = queryset.none()
        return queryset.order_by('-id')

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        loan = self.get_object()
        payload = request.data.copy()
        if loan.loan_type.name.strip().lower() == "mortgage":
            product_id = payload.get("mortgage_product_id", payload.get("product", loan.mortgage_details.product_id))
            customer_id = payload.get("customer_id", payload.get("customer", loan.customer_id))
            try:
                raw_quantity = payload.get("quantity", loan.mortgage_details.quantity)
                quantity = Decimal(str(raw_quantity)) if raw_quantity not in ('', None) else None
                amount = Decimal(str(payload.get("amount", payload.get("loan_amount", loan.loan_amount)) or 0))
                percentage = Decimal(str(payload.get("interest_percentage", loan.mortgage_details.interest_percentage) or 0))
            except Exception:
                return Response({"detail": "Enter valid mortgage quantity, loan amount and interest rate."}, status=400)
            start_value = payload.get("start_date", payload.get("loan_start_date", loan.loan_start_date))
            try:
                start_date = date.fromisoformat(str(start_value)) if not isinstance(start_value, date) else start_value
            except (TypeError, ValueError):
                return Response({"detail": "Invalid loan start date."}, status=400)
            try:
                product = Mortgage.objects.filter(pk=product_id, is_active=True).first() if product_id else None
            except (TypeError, ValueError):
                product = None
            if product_id and not product:
                return Response({'detail': 'Select a valid Mortgage Product.'}, status=400)
            if quantity is not None and (not quantity.is_finite() or quantity <= 0):
                return Response({'detail': 'Quantity must be greater than zero when supplied.'}, status=400)
            if not customer_id or not amount.is_finite() or not percentage.is_finite() or amount <= 0 or percentage <= 0:
                return Response({"detail": "Customer, loan amount and interest rate are required."}, status=400)
            rate = (loan.mortgage_details.current_rate if product.pk == loan.mortgage_details.product_id else product.current_rate) if product else Decimal('0')
            market_value = ((quantity or Decimal('0')) * rate).quantize(Decimal("0.01"))
            daily_interest = (amount * percentage / Decimal("100") / Decimal("365")).quantize(Decimal("0.01"))
            loan.customer_id = customer_id
            loan.loan_amount = amount
            loan.loan_start_date = start_date
            loan.save(update_fields=("customer", "loan_amount", "loan_start_date", "modified_date"))
            mortgage = loan.mortgage_details
            if not product or mortgage.product_id != product.pk:
                mortgage.product_name = product.product_name if product else ''
                mortgage.unit = product.unit if product else ''
            mortgage.product = product
            mortgage.quantity = quantity
            mortgage.current_rate = rate
            mortgage.market_value = market_value
            mortgage.loan_amount = amount
            mortgage.interest_percentage = percentage
            mortgage.daily_interest_amount = daily_interest
            mortgage.save()
            generate_customer_mortgage_installment(loan, mortgage)
            record_mortgage_history(loan, request.user, 'UPDATED')
            return Response(self.get_serializer(loan).data)
        if loan.loan_type.name.strip().lower() == "interest":
            amount = Decimal(str(payload.get("amount", loan.loan_amount) or 0)); percentage = Decimal(str(payload.get("interest_percentage", loan.interest_details.interest_percentage) or 0)); duration = int(payload.get("interest_duration", loan.interest_details.duration_value) or 0)
            try: start_date = date.fromisoformat(str(payload.get("start_date", loan.loan_start_date)))
            except (TypeError, ValueError): return Response({"detail": "Invalid loan start date."}, status=400)
            periodicity = str(payload.get("periodicity", loan.interest_details.loan_installment.name)); master = LoanInstallment.objects.filter(name__iexact=periodicity, is_active=True).first()
            if amount <= 0 or percentage <= 0 or duration <= 0 or not master: return Response({"detail": "Enter valid principal, interest percentage, periodicity and duration."}, status=400)
            interest_amount = (amount * percentage / Decimal("100")).quantize(Decimal("0.01")); total_payable = amount + interest_amount; per_installment = (total_payable / duration).quantize(Decimal("0.01")); interest = loan.interest_details
            loan.customer_id = payload.get("customer_id", loan.customer_id)
            loan.loan_amount = amount; loan.loan_start_date = start_date; loan.total_amount = total_payable; loan.outstanding_amount = max(Decimal("0.00"), total_payable - loan.paid_amount); loan.save(update_fields=("customer", "loan_amount", "loan_start_date", "total_amount", "outstanding_amount", "modified_date"))
            yearly = periodicity in ("Annual", "Other", "Others"); interest.principal_amount = amount; interest.interest_percentage = percentage; interest.interest_amount = interest_amount; interest.total_payable_amount = total_payable; interest.loan_installment = master; interest.duration_value = duration; interest.duration_type = payload.get("interest_duration_type", interest.duration_type); interest.start_date = start_date; interest.installment_count = duration; interest.installment_amount = per_installment; interest.collection_day = payload.get("interest_collection_day", interest.collection_day); interest.collection_month = payload.get("interest_collection_month") or (interest.collection_month if yearly else None); collection_day = int(payload.get("interest_collection_day", interest.collection_date.day if interest.collection_date else 1) or 1); interest.collection_date = date(start_date.year, int(interest.collection_month or start_date.month), min(collection_day, monthrange(start_date.year, int(interest.collection_month or start_date.month))[1])) if periodicity in ("Monthly", "Annual", "Other", "Others") else None; interest.save()
            generate_customer_interest_installments(loan, interest, bool(payload.get("include_sunday", False)), holiday_dates_for(payload.get("selected_holidays") or []))
            return Response(self.get_serializer(loan).data)
        group_id = payload.get("chit_group_id", payload.get("group", loan.chit_details.chit_group_id))
        if str(group_id) != str(loan.chit_details.chit_group_id) and not ChitGroup.objects.filter(pk=group_id, is_active=True).exists():
            return Response({"detail": "The selected Chit Group is deactivated or does not exist."}, status=400)
        selected_ids = payload.get("selected_holidays", payload.get("selected_holiday_ids", list(loan.holiday_settings.filter(include_in_schedule=True).values_list("holiday_id", flat=True))))
        if isinstance(selected_ids, str):
            selected_ids = [item for item in selected_ids.split(",") if item]
        customer_id = payload.get("customer_id", payload.get("customer", loan.customer_id))
        amount = Decimal(str(payload.get("amount", payload.get("loan_amount", loan.loan_amount)) or 0))
        start_value = payload.get("start_date", payload.get("loan_start_date", loan.loan_start_date))
        try:
            start_date = date.fromisoformat(str(start_value)) if not isinstance(start_value, date) else start_value
        except (TypeError, ValueError):
            return Response({"detail": "Invalid loan start date."}, status=400)
        if not customer_id or not group_id or amount <= 0:
            return Response({"detail": "Customer, Chit Group and a valid amount are required."}, status=400)
        loan.customer_id = customer_id
        loan.loan_amount = amount
        loan.loan_start_date = start_date
        loan.save(update_fields=("customer", "loan_amount", "loan_start_date", "modified_date"))
        chit = loan.chit_details
        chit.chit_group_id = group_id
        chit.include_sunday = bool(payload.get("include_sunday", chit.include_sunday))
        chit.save(update_fields=("chit_group", "include_sunday", "modified_date"))
        LoanHolidaySettings.objects.filter(loan=loan).delete()
        for holiday_id in selected_ids:
            if str(holiday_id).startswith("sunday-"):
                continue
            try:
                holiday = HolidayMaster.objects.get(pk=holiday_id, is_active=True)
            except HolidayMaster.DoesNotExist:
                continue
            LoanHolidaySettings.objects.create(loan=loan, holiday=holiday, include_in_schedule=True)
        generate_customer_chit_installments(loan, chit, loan.holiday_settings.select_related("holiday"))
        return Response(self.get_serializer(loan).data)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """Accept the existing loan-form payload and split it into canonical tables."""
        from decimal import Decimal
        from customers.models import Customer
        payload = request.data.copy()
        loan_type_id = payload.get("loan_type_id")
        group_id = payload.pop("chit_group_id", payload.pop("group", None))
        include_sunday = payload.pop("include_sunday", False)
        periodicity = payload.pop("periodicity", "")
        selected_ids = payload.pop("selected_holidays", payload.pop("selected_holiday_ids", []))
        payload.pop("loan_type_id", None)
        if isinstance(selected_ids, str):
            selected_ids = [item for item in selected_ids.split(",") if item]
        loan_type = LoanType.objects.filter(pk=loan_type_id, is_active=True).first()
        if loan_type_id and not loan_type:
            return Response({"detail": "The selected Loan Type is unavailable or does not exist."}, status=400)
        if loan_type and loan_type.name.strip().lower() == "interest":
            from customers.models import Customer
            customer_id = payload.get("customer_id", payload.get("customer"))
            amount = Decimal(str(payload.get("amount", payload.get("loan_amount", 0)) or 0))
            percentage = Decimal(str(payload.get("interest_percentage", 0) or 0))
            duration = int(payload.get("interest_duration", 0) or 0)
            start_value = payload.get("start_date", payload.get("loan_start_date"))
            try: start_date = date.fromisoformat(str(start_value))
            except (TypeError, ValueError): return Response({"detail": "Invalid loan start date."}, status=400)
            if not customer_id or amount <= 0 or percentage <= 0 or duration <= 0: return Response({"detail": "Customer, principal, interest percentage and duration are required."}, status=400)
            periodicity = str(periodicity or "Monthly")
            installment_master = LoanInstallment.objects.filter(name__iexact=periodicity, is_active=True).first()
            if not installment_master: return Response({"detail": f"Unsupported interest periodicity: {periodicity}."}, status=400)
            interest_amount = (amount * percentage / Decimal("100")).quantize(Decimal("0.01"))
            total_payable = amount + interest_amount
            per_installment = (total_payable / duration).quantize(Decimal("0.01"))
            common = {"customer": customer_id, "loan_type": loan_type.pk, "loan_amount": amount, "loan_start_date": start_date, "total_amount": total_payable, "paid_amount": 0, "penalty_amount": 0, "outstanding_amount": total_payable, "loan_status": "ACTIVE", "is_active": True, "done_by_staff": payload.get("done_by_staff")}
            loan = self.get_serializer(data=common); loan.is_valid(raise_exception=True); loan = loan.save()
            yearly = periodicity in ("Annual", "Other", "Others")
            collection_month = payload.get("interest_collection_month") or (start_date.month if yearly else None)
            collection_month_value = int(collection_month or start_date.month); collection_day = int(payload.get("interest_collection_day") or 1)
            collection_date = date(start_date.year, collection_month_value, min(collection_day, monthrange(start_date.year, collection_month_value)[1])) if periodicity in ("Monthly", "Annual", "Other", "Others") else None
            interest = InterestDetails.objects.create(loan=loan, principal_amount=amount, interest_percentage=percentage, interest_amount=interest_amount, total_payable_amount=total_payable, loan_installment=installment_master, duration_value=duration, duration_type=payload.get("interest_duration_type", ""), start_date=start_date, collection_day=payload.get("interest_collection_day"), collection_date=collection_date, collection_month=collection_month, installment_count=duration, installment_amount=per_installment, paid_amount=0, outstanding_amount=total_payable)
            generate_customer_interest_installments(loan, interest, bool(include_sunday), holiday_dates_for(selected_ids))
            return Response(self.get_serializer(loan).data, status=201)
        if loan_type and loan_type.name.strip().lower() == "mortgage":
            from customers.models import Customer
            customer_id = payload.get("customer_id", payload.get("customer"))
            product_id = payload.get("mortgage_product_id", payload.get("product"))
            try:
                raw_quantity = payload.get('quantity')
                quantity = Decimal(str(raw_quantity)) if raw_quantity not in ('', None) else None
                amount = Decimal(str(payload.get("amount", payload.get("loan_amount", 0)) or 0))
                percentage = Decimal(str(payload.get("interest_percentage", 0) or 0))
            except Exception:
                return Response({"detail": "Enter valid mortgage quantity, loan amount and interest rate."}, status=400)
            start_value = payload.get("start_date", payload.get("loan_start_date")) or timezone.localdate()
            try:
                start_date = date.fromisoformat(str(start_value)) if not isinstance(start_value, date) else start_value
            except (TypeError, ValueError):
                return Response({"detail": "Invalid loan start date."}, status=400)
            try:
                product = Mortgage.objects.filter(pk=product_id, is_active=True).first() if product_id else None
            except (TypeError, ValueError):
                product = None
            if product_id and not product:
                return Response({'detail': 'Select a valid Mortgage Product.'}, status=400)
            if quantity is not None and (not quantity.is_finite() or quantity <= 0):
                return Response({'detail': 'Quantity must be greater than zero when supplied.'}, status=400)
            if not customer_id or not amount.is_finite() or not percentage.is_finite() or amount <= 0 or percentage <= 0:
                return Response({"detail": "Customer, loan amount and interest rate are required."}, status=400)
            rate = product.current_rate if product else Decimal('0')
            market_value = ((quantity or Decimal('0')) * rate).quantize(Decimal("0.01"))
            daily_interest = (amount * percentage / Decimal("100") / Decimal("365")).quantize(Decimal("0.01"))
            common = {"customer": customer_id, "loan_type": loan_type.pk, "loan_amount": amount, "loan_start_date": start_date, "total_amount": amount + daily_interest, "paid_amount": 0, "penalty_amount": 0, "outstanding_amount": amount + daily_interest, "loan_status": "ACTIVE", "is_active": True, "done_by_staff": payload.get("done_by_staff")}
            loan = self.get_serializer(data=common)
            loan.is_valid(raise_exception=True)
            loan = loan.save()
            mortgage = MortgageLoanDetails.objects.create(loan=loan, product=product, product_name=product.product_name if product else '', unit=product.unit if product else '', quantity=quantity, current_rate=rate, market_value=market_value, loan_amount=amount, interest_percentage=percentage, daily_interest_amount=daily_interest)
            generate_customer_mortgage_installment(loan, mortgage)
            record_mortgage_history(loan, request.user, 'CREATED')
            return Response(self.get_serializer(loan).data, status=201)
        if "customer_id" in payload:
            payload["customer"] = payload.pop("customer_id")
        if "amount" in payload:
            payload["loan_amount"] = payload.pop("amount")
        if "start_date" in payload:
            payload["loan_start_date"] = payload.pop("start_date")
        customer_id = payload.get("customer")
        if not customer_id or not group_id:
            return Response({"detail": "customer and chit_group are required."}, status=400)
        if not ChitGroup.objects.filter(pk=group_id, is_active=True).exists():
            return Response({"detail": "The selected Chit Group is deactivated or does not exist."}, status=400)
        loan_type = LoanType.objects.get_or_create(name="Chit", defaults={"is_active": True})[0]
        amount = Decimal(str(payload.get("loan_amount") or 0))
        payload.update({"loan_type": loan_type.pk, "total_amount": amount, "paid_amount": 0,
                        "penalty_amount": 0, "outstanding_amount": amount,
                        "loan_status": "ACTIVE", "is_active": True})
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)
        loan = serializer.save()
        chit = CustomerChitDetails.objects.create(loan=loan, chit_group_id=group_id, include_sunday=bool(include_sunday))
        for holiday_id in selected_ids:
            if str(holiday_id).startswith("sunday-"):
                continue
            try:
                holiday = HolidayMaster.objects.get(pk=holiday_id, is_active=True)
            except HolidayMaster.DoesNotExist:
                continue
            LoanHolidaySettings.objects.update_or_create(loan=loan, holiday=holiday, defaults={"include_in_schedule": True})
        rows = generate_customer_chit_installments(loan, chit, loan.holiday_settings.select_related("holiday"))
        return Response(self.get_serializer(loan).data, status=201)

    @action(detail=True, methods=["post"], url_path="generate-schedule")
    def generate_customer_schedule(self, request, pk=None):
        loan = self.get_object()
        if not hasattr(loan, "chit_details"):
            return Response({"detail": "This loan has no Chit mapping."}, status=400)
        rows = generate_customer_chit_installments(loan, loan.chit_details, loan.holiday_settings.select_related("holiday"))
        return Response(CustomerLoanInstallmentDetailsSerializer(rows, many=True).data)


class InterestDetailsViewSet(FinanceViewSet):
    queryset = InterestDetails.objects.all(); serializer_class = InterestDetailsSerializer


class CustomerChitDetailsViewSet(FinanceViewSet):
    queryset = CustomerChitDetails.objects.all(); serializer_class = CustomerChitDetailsSerializer


class CustomerLoanInstallmentDetailsViewSet(FinanceViewSet):
    queryset = CustomerLoanInstallmentDetails.objects.all(); serializer_class = CustomerLoanInstallmentDetailsSerializer

    @action(detail=True, methods=["post"], url_path="collect")
    @transaction.atomic
    def collect(self, request, pk=None):
        installment = self.get_object()
        # Serialize collections for a loan before reading balances or accepting a retry.
        loan = CustomerLoanDetails.objects.select_for_update().get(pk=installment.loan_id)
        request_key = str(request.data.get("request_key") or "").strip()
        if len(request_key) > 64:
            return Response({"detail": "Invalid collection request key."}, status=400)
        existing = CollectionTransaction.objects.filter(loan=loan, request_key=request_key).first() if request_key else None
        if existing:
            from decimal import Decimal, InvalidOperation
            try:
                matching = (existing.collection_amount == Decimal(str(request.data.get("customer_paid_amount", "0")))
                            and existing.advance_amount == Decimal(str(request.data.get("advance_amount") or "0")))
                requested_split = sorted((int(item["installment_id"]), Decimal(str(item["amount"]))) for item in request.data.get("allocations", []) if Decimal(str(item["amount"])) > 0)
                saved_split = sorted(existing.allocations.values_list("installment_id", "amount"))
                matching = matching and requested_split == saved_split
            except (InvalidOperation, TypeError, ValueError, KeyError):
                matching = False
            if not matching:
                return Response({"detail": "This collection request was already saved with different amounts."}, status=409)
            return Response({"detail": "Collection already saved.", "loan_id": loan.pk, "collection_id": existing.pk})
        from decimal import Decimal, InvalidOperation
        try:
            received = Decimal(str(request.data.get("customer_paid_amount", request.data.get("received_amount", "0"))))
            advance = Decimal(str(request.data.get("advance_amount") or "0"))
            penalty = Decimal(str(request.data.get("penalty", "0")))
            discount = Decimal(str(request.data.get("discount", "0")))
            payment_date = date.fromisoformat(str(request.data.get("payment_date")))
        except (InvalidOperation, TypeError, ValueError):
            return Response({"detail": "Enter a valid payment date and amount."}, status=400)
        if any(not value.is_finite() for value in (received, advance, penalty, discount)) or advance < 0 or advance > received:
            return Response({"detail": "Enter valid collection and advance amounts."}, status=400)
        applied_received = received - advance
        # Cash/Bank side is resolved from the Payment Mode (existing API default: Cash):
        # Cash -> default Cash-in-Hand ledger, other modes -> the selected Bank Accounts ledger.
        try:
            account = resolve_account(request.data.get("payment_mode", "Cash"), request.data.get("account_id") or None)
        except LedgerMappingError as error:
            return Response({"detail": error.message, error.field: error.message}, status=400)
        # The Ledger entry is recorded alongside the collection; it never changes installment dues or loan outstanding.
        ledger_group = str(request.data.get("ledger_group") or "").strip()
        ledger = None
        if request.data.get("ledger_id"):
            ledger = Ledger.objects.filter(pk=request.data.get("ledger_id")).first() if str(request.data.get("ledger_id")).isdigit() else None
            if ledger is None:
                return Response({"detail": "Select a valid Ledger."}, status=400)
            ledger_group = ledger.group
        try:
            ledger_amount = Decimal(str(request.data.get("ledger_amount") or "0"))
        except (InvalidOperation, TypeError, ValueError):
            return Response({"detail": "Enter a valid Ledger Amount."}, status=400)
        if ledger_amount < 0:
            return Response({"detail": "Ledger Amount cannot be negative."}, status=400)
        if ledger is None and ledger_group and ledger_group not in dict(CollectionTransaction.LEDGER_GROUPS):
            return Response({"detail": "Select a valid Ledger."}, status=400)
        if ledger_amount > 0 and not ledger_group:
            return Response({"detail": "Select a Ledger for the Ledger Amount."}, status=400)
        party_ledger = None
        if request.data.get("party_ledger_id"):
            party_id = request.data["party_ledger_id"]
            party_ledger = Ledger.objects.filter(pk=party_id).first() if str(party_id).isdigit() else None
            if party_ledger is None:
                return Response({"detail": "Select a valid party Ledger."}, status=400)
            if party_ledger.customer_id and party_ledger.customer_id != installment.loan.customer_id:
                return Response({"detail": "The selected Ledger does not belong to this loan's customer."}, status=400)
            if is_account_ledger(party_ledger):
                return Response({"detail": "Cash in Hand and Bank Accounts belong in Accounts, not Ledger."}, status=400)
        else:
            # Collections always credit a Ledger: default to the customer's own ledger.
            party_ledger = customer_ledger(installment.loan.customer)
        all_rows = list(loan.installment_details.select_for_update().order_by("due_date", "pk"))
        remaining_total = sum((max(Decimal("0.00"), row.installment_amount - row.paid_amount) for row in all_rows), Decimal("0.00"))
        if received <= 0:
            return Response({"detail": "Customer Paid Amount must be greater than zero."}, status=400)
        if advance > max(Decimal("0.00"), received - remaining_total):
            return Response({"detail": "Others may contain only the excess above pending dues."}, status=400)
        if applied_received > remaining_total + penalty - discount:
            return Response({"detail": f"Customer Paid Amount exceeds the remaining loan outstanding by {received - remaining_total:.2f}."}, status=400)
        allocations = []
        allocated_rows = []
        remaining = applied_received
        requested = request.data.get("allocations")
        if requested:
            # View Statement: the user chose the dues and the amount for each. Every due must
            # belong to this loan, appear once and never take more than its pending balance;
            # together they must account for the whole Collection Amount.
            if not isinstance(requested, list):
                return Response({"detail": "Send the installment allocations as a list."}, status=400)
            by_id = {row.pk: row for row in all_rows}
            seen = set()
            for item in requested:
                item = item if isinstance(item, dict) else {}
                key = str(item.get("installment_id", "")).strip()
                row = by_id.get(int(key)) if key.isdigit() else None
                if row is None:
                    return Response({"detail": "Select installments of this loan only."}, status=400)
                if row.pk in seen:
                    return Response({"detail": f"Installment #{row.installment_number} is listed more than once."}, status=400)
                seen.add(row.pk)
                try:
                    applied = Decimal(str(item.get("amount", ""))).quantize(Decimal("0.01"))
                except (InvalidOperation, TypeError, ValueError):
                    return Response({"detail": f"Installment #{row.installment_number}: enter a valid amount."}, status=400)
                if not applied.is_finite() or applied < 0:
                    return Response({"detail": f"Installment #{row.installment_number}: enter a valid amount."}, status=400)
                if not applied:
                    continue
                balance = max(Decimal("0.00"), row.installment_amount - row.paid_amount)
                if applied > balance:
                    return Response({"detail": f"Installment #{row.installment_number}: allocation {applied:.2f} exceeds its pending {balance:.2f}."}, status=400)
                allocated_rows.append((row, applied))
            if sum((applied for _, applied in allocated_rows), Decimal("0.00")) != applied_received:
                return Response({"detail": "Allocated installments plus Others must add up to the Collection Amount."}, status=400)
            allocated_rows.sort(key=lambda pair: (pair[0].due_date, pair[0].pk))
            for row, applied in allocated_rows:
                row.paid_amount += applied
                row.paid_date = payment_date
                allocations.append({"installment_number": row.installment_number, "amount": applied})
            remaining = Decimal("0.00")
        for row in all_rows if not requested else ():
            balance = max(Decimal("0.00"), row.installment_amount - row.paid_amount)
            if balance <= 0 or remaining <= 0:
                continue
            applied = min(balance, remaining)
            row.paid_amount += applied
            remaining -= applied
            row.paid_date = payment_date
            allocations.append({"installment_number": row.installment_number, "amount": applied})
            allocated_rows.append((row, applied))
        if allocations and penalty:
            first = next(row for row in all_rows if row.installment_number == allocations[0]["installment_number"])
            first.penalty_amount += penalty
        collection = None
        if allocations or advance:
            first = allocated_rows[0][0] if allocated_rows else installment
            details = request.data
            cheque_date = details.get("cheque_date") or None
            collection = CollectionTransaction.objects.create(
                installment=first, loan=loan, customer=loan.customer,
                collection_amount=received, advance_amount=advance, request_key=request_key, collection_date=payment_date,
                payment_mode=details.get("payment_mode", "Cash"),
                reference_no=details.get("transaction_utr") or details.get("utr_number") or details.get("reference_number") or details.get("neft_reference") or "",
                remarks=details.get("notes", ""), upi_id=details.get("upi_id", ""),
                bank_name=details.get("bank_name", ""), cheque_number=details.get("cheque_number", ""),
                cheque_date=cheque_date, adjustment_type=details.get("adjustment_type", ""),
                adjustment_amount=penalty, discount_amount=discount, account=account,
                ledger_group=ledger_group, ledger_amount=ledger_amount, ledger=ledger, party_ledger=party_ledger,
                done_by_staff_id=details.get("done_by_staff") or None,
            )
            CollectionAllocation.objects.bulk_create([CollectionAllocation(transaction=collection, installment=row, amount=applied) for row, applied in allocated_rows])
        for row in all_rows:
            row.outstanding_amount = max(Decimal("0.00"), row.installment_amount + row.penalty_amount - row.paid_amount)
            row.payment_status = "PAID" if row.outstanding_amount <= 0 else "PARTIAL" if row.paid_amount > 0 else "OVERDUE" if row.due_date < payment_date else "PENDING"
            row.save(update_fields=("paid_amount", "penalty_amount", "outstanding_amount", "payment_status", "paid_date", "modified_date"))
        loan.total_amount = sum((row.installment_amount for row in all_rows), Decimal("0.00"))
        loan.paid_amount = sum((row.paid_amount for row in all_rows), Decimal("0.00"))
        loan.penalty_amount = sum((row.penalty_amount for row in all_rows), Decimal("0.00"))
        loan.outstanding_amount = max(Decimal("0.00"), loan.total_amount + loan.penalty_amount - loan.paid_amount)
        loan.loan_status = "COMPLETED" if loan.outstanding_amount <= 0 else "ACTIVE"
        loan.is_active = loan.outstanding_amount > 0
        loan.save(update_fields=("total_amount", "paid_amount", "penalty_amount", "outstanding_amount", "loan_status", "is_active", "modified_date"))
        return Response({"detail": "Collection saved successfully.", "allocations": allocations, "remaining_unallocated": remaining, "loan_id": loan.id, "collection_id": collection.id if collection else None})


def holiday_dates_for(ids):
    """Dates of the active holidays a loan form explicitly includes (ids; "sunday-…" keys ignored)."""
    numeric = [int(value) for value in ids if str(value).isdigit()]
    return set(HolidayMaster.objects.filter(pk__in=numeric, is_active=True).values_list("holiday_date", flat=True)) if numeric else set()


class HolidayMasterViewSet(FinanceViewSet):
    pagination_class = None
    queryset = HolidayMaster.objects.select_related("done_by_staff").all(); serializer_class = HolidayMasterSerializer

    delete_label = "holiday"

    @action(detail=True, methods=["get"])
    def allocations(self, request, pk=None):
        holiday = self.get_object()
        candidates = CustomerLoanDetails.objects.filter(installment_details__due_date=holiday.holiday_date).distinct()
        saved = dict(LoanHolidaySettings.objects.filter(holiday=holiday, include_in_schedule=True).values_list("loan_id", "id"))
        return Response([{"loan_id": loan.pk, "loan_no": loan.loan_no, "allocation_id": saved.get(loan.pk)} for loan in candidates])

    @action(detail=True, methods=["post"])
    def allocate(self, request, pk=None):
        holiday = self.get_object()
        loan_id = request.data.get("loan_id")
        if not str(loan_id).isdigit() or not holiday.is_active:
            return Response({"detail": "Select a valid collection loan and active holiday."}, status=400)
        loan = CustomerLoanDetails.objects.filter(pk=loan_id, installment_details__due_date=holiday.holiday_date).first()
        if loan is None:
            return Response({"detail": "This loan has no collection scheduled on this date."}, status=400)
        setting, created = LoanHolidaySettings.objects.get_or_create(loan=loan, holiday=holiday, defaults={"include_in_schedule": True})
        if not created and not setting.include_in_schedule:
            return Response({"detail": "Use Edit to change the existing allocation."}, status=409)
        return Response({"id": setting.pk, "loan_id": loan.pk, "loan_no": loan.loan_no}, status=201 if created else 200)



class LoanHolidaySettingsViewSet(FinanceViewSet):
    queryset = LoanHolidaySettings.objects.select_related("loan", "holiday"); serializer_class = LoanHolidaySettingsSerializer


@api_view(["POST"])
def preview_chit_schedule(request):
    payload = request.data
    group = None
    if payload.get("chit_group_id"):
        try:
            group = ChitGroup.objects.get(pk=payload["chit_group_id"])
        except (ChitGroup.DoesNotExist, TypeError, ValueError):
            return Response({"detail": "Invalid Chit Group."}, status=400)
    start_value = (payload.get("start_date") or payload.get("loan_start_date")
                   or payload.get("chit_start_date") or (group.start_date if group else None))
    if not start_value:
        return Response({"detail": "Loan Start Date is required."}, status=400)

    def parse_api_date(value):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value)):
            raise ValueError("Dates must use YYYY-MM-DD.")
        return date.fromisoformat(str(value))

    try:
        start_date = parse_api_date(start_value)
        duration = group.duration if group else int(payload["duration"])
        duration_type = group.duration_type if group else payload["duration_type"]
        include_sunday = bool(payload.get("include_sunday", False))
        # Same rule as the saved schedule: the Holiday Calendar (holidays Off, Sundays Off
        # unless ticked Working) minus the holidays this loan explicitly includes, plus any
        # extra dates the client blocks.
        included = holiday_dates_for(payload.get("selected_holidays") or [])
        horizon = start_date + timedelta(days=(int(duration) * 3 if str(duration_type).upper() == "DAY" else int(duration) * 366))
        blocked = calendar_blocked_dates(start_date, horizon, include_sunday, included)
        blocked.update(parse_api_date(value) for value in (payload.get("blocked_holidays") or []))
        blocked.difference_update(included)
        rows = generate_chit_schedule(
            start_date, duration, duration_type,
            collection_day=group.collection_day if group else payload.get("collection_day"),
            collection_month=group.collection_month if group else payload.get("collection_month"),
            include_sunday=True, holidays=blocked,
        )
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        return Response({"detail": f"Invalid Loan Start Date or schedule details: {exc}"}, status=400)
    return Response({"loan_end_date": rows[-1].due_date, "installments": [{"installment_number": r.installment_number, "due_date": r.due_date} for r in rows]})


def _status(row, today=None):
    today = today or timezone.localdate()
    balance = row.installment_amount - row.paid_amount
    if balance <= 0:
        return "PAID LATE" if row.paid_date and row.paid_date > row.due_date else "PAID"
    if row.due_date < today:
        return "OVERDUE"
    if row.paid_amount > 0:
        return "PARTIAL"
    return "UPCOMING"


def _filtered_installments(request, apply_status=True, include_future=False):
    rows = CustomerLoanInstallmentDetails.objects.select_related(
        "loan", "loan__customer", "loan__loan_type", "loan__chit_details__chit_group",
    )
    from_value, to_value = request.query_params.get("from"), request.query_params.get("to")
    if from_value: rows = rows.filter(due_date__gte=from_value)
    if to_value and not include_future: rows = rows.filter(due_date__lte=to_value)
    search = request.query_params.get("search", "").strip()
    if search:
        rows = rows.filter(
            Q(loan__customer__full_name__icontains=search)
            | Q(loan__customer__customer_code__icontains=search)
            | Q(loan__customer__primary_mobile__icontains=search)
            | Q(loan__customer__alternate_mobile__icontains=search)
            | Q(loan__customer__whatsapp_number__icontains=search)
            | Q(loan__customer__role__icontains=search)
            | Q(loan__loan_no__icontains=search)
            | Q(loan__loan_type__name__icontains=search)
            | Q(loan__chit_details__chit_group__name__icontains=search)
            | Q(paid_date__icontains=search)
            | Q(due_date__icontains=search)
            | Q(installment_number__icontains=search)
            | Q(installment_amount__icontains=search)
            | Q(paid_amount__icontains=search)
            | Q(loan__total_amount__icontains=search)
            | Q(loan__outstanding_amount__icontains=search)
            | Q(payment_status__icontains=search)
        ).distinct()
    loan_number = request.query_params.get("loan_number", "").strip()
    if loan_number:
        rows = rows.filter(loan__loan_no=loan_number)
    customer_id = request.query_params.get("customer_id", "").strip()
    if customer_id:
        rows = rows.filter(loan__customer_id=customer_id)
    customer_type = request.query_params.get("customer_type", "").strip().upper()
    if customer_type:
        rows = rows.filter(loan__customer__role=customer_type)
    status_filter = request.query_params.get("status", "").upper()
    if status_filter and apply_status:
        aliases = {"PENDING": {"UPCOMING", "PENDING"}, "OUTSTANDING": {"PARTIAL", "OVERDUE", "UPCOMING"}, "PAID": {"PAID", "PAID LATE"}, "OVERDUE": {"OVERDUE"}}
        rows = [row for row in rows if _status(row) in aliases.get(status_filter, {status_filter})]
    return rows


@api_view(["GET"])
def customer_collection_report(request, customer_id):
    loans = CustomerLoanDetails.objects.filter(customer_id=customer_id).select_related(
        "customer", "loan_type", "interest_details__loan_installment", "chit_details__chit_group"
    ).prefetch_related("installment_details")
    customer = loans.first().customer if loans.exists() else None
    if not customer:
        return Response({"detail": "Customer not found."}, status=404)
    loan_items = []
    receivable_schedule = []
    payable_schedule = []
    today = timezone.localdate()
    for loan in loans:
        interest = getattr(loan, "interest_details", None)
        chit = getattr(loan, "chit_details", None)
        duration_type = chit.chit_group.duration_type if chit else (interest.loan_installment.name if interest else "Other")
        duration = chit.chit_group.duration if chit else (interest.duration_value if interest else len(loan.installment_details.all()))
        loan_items.append({
            "id": loan.id, "loan_no": loan.loan_no, "customer_type": customer.get_role_display(),
            "loan_type": loan.loan_type.name, "chit_group": chit.chit_group.name if chit else None,
            "duration": duration, "duration_type": duration_type, "start_date": loan.loan_start_date,
            "end_date": loan.loan_end_date, "interest_percentage": interest.interest_percentage if interest else 0,
            "installment_amount": interest.installment_amount if interest else None,
            "loan_amount": loan.loan_amount, "overall_amount": loan.total_amount,
        })
        for row in loan.installment_details.all():
            status = _status(row)
            balance = max(Decimal("0"), row.installment_amount - row.paid_amount)
            paid = max(Decimal("0"), row.paid_amount)
            if balance > 0:
                display_status = "Overdue" if row.due_date < today else "Outstanding" if paid > 0 else "Pending"
                receivable_schedule.append({
                    "id": row.id, "installment_id": row.id, "loan_id": loan.id, "loan_no": loan.loan_no,
                    "date": row.due_date, "due_date": row.due_date, "duration": duration_type,
                    "cycle": row.installment_number, "installment_number": row.installment_number,
                    "amount": row.installment_amount, "installment_amount": row.installment_amount,
                    "paid": paid, "total_paid": paid, "balance": balance, "status": display_status,
                    "payment_date": row.paid_date,
                })
            if paid > 0:
                payable_schedule.append({
                    "id": row.id, "installment_id": row.id, "loan_id": loan.id, "loan_no": loan.loan_no,
                    "payment_date": row.paid_date, "date": row.due_date, "due_date": row.due_date,
                    "duration": duration_type, "cycle": row.installment_number,
                    "installment_number": row.installment_number, "amount": row.installment_amount,
                    "installment_amount": row.installment_amount, "paid": paid, "total_paid": paid, "balance": balance,
                    "status": "Paid" if balance <= 0 else "Partial",
                })
    receivable_total = sum((row["balance"] for row in receivable_schedule), Decimal("0"))
    received = sum((row["paid"] for row in payable_schedule), Decimal("0"))
    outstanding = sum((row["balance"] for row in receivable_schedule if row["status"] == "Outstanding"), Decimal("0"))
    pending = sum((row["balance"] for row in receivable_schedule if row["status"] == "Pending"), Decimal("0"))
    overdue = sum((row["balance"] for row in receivable_schedule if row["status"] == "Overdue"), Decimal("0"))
    fully_paid = sum((row["paid"] for row in payable_schedule if row["status"] == "Paid"), Decimal("0"))
    partial_paid = sum((row["paid"] for row in payable_schedule if row["status"] == "Partial"), Decimal("0"))
    return Response({
        "customer": {"id": customer.id, "customer_code": customer.customer_code, "customer_name": customer.full_name, "phone": customer.primary_mobile, "customer_type": customer.get_role_display()},
        "loans": loan_items,
        "receivable_summary": {"overall": receivable_total, "outstanding": outstanding, "pending": pending, "overdue": overdue},
        "receivable_schedule": receivable_schedule,
        "payable_summary": {"overall": received, "paid": received, "fully_paid": fully_paid, "partial_paid": partial_paid, "balance": Decimal("0")},
        "payable_schedule": payable_schedule,
    })


@api_view(["GET"])
def payments_compatibility(request):
    """Read-only payment-shaped response backed by installment collection fields."""
    rows = CustomerLoanInstallmentDetails.objects.select_related("loan", "loan__customer").filter(paid_amount__gt=0)
    results = [{
        "id": row.id, "number": f"COL-{row.id:06d}", "party": row.loan.customer_id,
        "loan": row.loan_id, "payment_date": row.paid_date, "amount": row.paid_amount,
        "penalty": row.penalty_amount, "mode": "", "status": _status(row),
        "installment_number": row.installment_number,
    } for row in rows]
    return Response({"count": len(results), "results": results})


def _collection_row(row, today):
    transactions = list(row.collection_transactions.all())
    paid = sum(((item.collection_amount or Decimal("0.00")) for item in transactions), Decimal("0.00"))
    if not transactions:
        paid = row.paid_amount or Decimal("0.00")
    due_amount = row.installment_amount or Decimal("0.00")
    penalty = row.penalty_amount or Decimal("0.00")
    balance = max(Decimal("0.00"), due_amount + penalty - paid)
    status = "PAID" if balance <= 0 else "PARTIAL" if paid > 0 else "PENDING"
    overdue = row.due_date < today and balance > 0
    return {"id": row.id, "installment_id": row.id, "loan_id": row.loan_id,
        "loan_no": row.loan.loan_no, "loan_name": row.loan.loan_type.name,
        "customer_id": row.loan.customer_id, "customer_name": row.loan.customer.full_name,
        "customer_code": row.loan.customer.customer_code, "phone": row.loan.customer.primary_mobile,
        "due_date": row.due_date, "due_amount": due_amount,
        "total_paid": paid, "paid": paid, "balance": balance,
        "payment_status": status, "status": status, "is_overdue": overdue,
        "days_overdue": max(0, (today - row.due_date).days) if overdue else 0,
        "due_days": max(0, (today - row.due_date).days) if overdue else 0,
        "payment_mode": transactions[-1].payment_mode if transactions else "",
        "collection_date": transactions[-1].collection_date if transactions else None,
        "done_by_staff": transactions[-1].done_by_staff_id if transactions else None,
        "done_by_staff_name": transactions[-1].done_by_staff.staff_name if transactions and transactions[-1].done_by_staff else None}


def _collection_queryset():
    return CustomerLoanInstallmentDetails.objects.select_related(
        "loan", "loan__customer", "loan__loan_type"
    ).prefetch_related("collection_transactions").order_by("due_date", "installment_number")


def collections_list(request):
    try:
        today = timezone.localdate()
        selected = request.query_params.get("date") or today.isoformat()
        try: selected_date = date.fromisoformat(selected)
        except (TypeError, ValueError): return Response({"detail": "Invalid collection date."}, status=400)
        rows = [_collection_row(row, selected_date) for row in _collection_queryset() if row.due_date == selected_date]
        rows = [row for row in rows if row["balance"] > 0]
        search = request.query_params.get("search", "").strip().lower()
        status = request.query_params.get("status", "").strip().upper()
        previous = request.query_params.get("previous", "")
        if previous:
            start = today
            if previous == "yesterday": start = today - timedelta(days=1)
            elif previous == "last_7_days": start = today - timedelta(days=7)
            elif previous == "this_month": start = today.replace(day=1)
            elif previous == "all_previous": start = date.min
            rows = [_collection_row(row, selected_date) for row in _collection_queryset() if row.due_date and start <= row.due_date < today]
            rows = [row for row in rows if row["balance"] > 0]
            rows.sort(key=lambda row: (row["due_date"], row["id"]))
        if search:
            rows = [row for row in rows if search in " ".join(str(row.get(key, "")) for key in ("customer_name", "customer_code", "phone", "loan_name", "loan_no")).lower()]
        loan_type = request.query_params.get("loan_type", "").strip().lower()
        if loan_type: rows = [row for row in rows if loan_type in str(row.get("loan_name", "")).lower()]
        if status and status != "ALL": rows = [row for row in rows if row["payment_status"] == status or (status == "OVERDUE" and row["is_overdue"])]
        return Response({"date": selected_date, "count": len(rows), "results": rows})
    except Exception:
        logger.exception("Collection list failed for query=%s", request.query_params.dict())
        return Response({"detail": "Unable to load collection data. Please try again."}, status=503)


def previous_pending(request):
    request.query_params._mutable = True
    request.query_params["previous"] = request.query_params.get("range", "all_previous")
    return collections_list(request)


@api_view(["GET"])
def collections_summary(request):
    today = timezone.localdate()
    rows = [_collection_row(row, today) for row in _collection_queryset()]
    def total(items): return sum((item["balance"] for item in items), Decimal("0.00"))
    today_rows = [item for item in rows if item["due_date"] == today]
    yesterday_rows = [item for item in rows if item["due_date"] == today - timedelta(days=1) and item["balance"] > 0]
    overdue_rows = [item for item in rows if item["due_date"] < today and item["balance"] > 0]
    return Response({"today_due": sum((item["due_amount"] for item in today_rows), Decimal("0.00")), "today_collected": sum((item["total_paid"] for item in today_rows), Decimal("0.00")), "today_remaining": total(today_rows), "yesterday_pending": total(yesterday_rows), "yesterday_count": len({item["customer_id"] for item in yesterday_rows}), "total_overdue": total(overdue_rows), "overdue_count": len({item["customer_id"] for item in overdue_rows})})


@transaction.atomic
def collections_create(request):
    from rest_framework.exceptions import ValidationError
    installment_id = request.data.get("installment_id")
    try: amount = Decimal(str(request.data.get("collection_amount", "0")))
    except Exception: amount = Decimal("0")
    if amount <= 0: return Response({"detail": "Collection amount must be greater than zero."}, status=400)
    installment = CustomerLoanInstallmentDetails.objects.select_for_update().select_related("loan", "loan__customer").filter(pk=installment_id).first()
    if not installment: return Response({"detail": "Installment was not found."}, status=404)
    paid = CollectionTransaction.objects.filter(installment=installment).aggregate(total=Sum("collection_amount"))["total"]
    paid = paid if paid is not None else installment.paid_amount
    balance = max(Decimal("0.00"), installment.installment_amount + installment.penalty_amount - paid)
    if amount > balance: return Response({"detail": f"Collection amount cannot exceed pending balance {balance:.2f}."}, status=400)
    payment_date = request.data.get("collection_date") or timezone.localdate()
    try: payment_date = date.fromisoformat(str(payment_date))
    except ValueError: return Response({"detail": "Collection date is invalid."}, status=400)
    try: account = resolve_account(request.data.get("payment_mode", "Cash"), request.data.get("account_id") or None)
    except LedgerMappingError as error: return Response({"detail": error.message, error.field: error.message}, status=400)
    collection = CollectionTransaction.objects.create(installment=installment, loan=installment.loan, customer=installment.loan.customer, collection_amount=amount, collection_date=payment_date, payment_mode=request.data.get("payment_mode", "Cash"), reference_no=request.data.get("reference_no", ""), remarks=request.data.get("remarks", ""), account=account, party_ledger=customer_ledger(installment.loan.customer), done_by_staff_id=request.data.get("done_by_staff") or None)
    CollectionAllocation.objects.create(transaction=collection, installment=installment, amount=amount)
    new_paid = paid + amount; new_balance = max(Decimal("0.00"), installment.installment_amount + installment.penalty_amount - new_paid)
    installment.paid_amount = new_paid; installment.outstanding_amount = new_balance; installment.paid_date = payment_date if new_balance <= 0 else installment.paid_date; installment.payment_status = "PAID" if new_balance <= 0 else "PARTIAL"; installment.save(update_fields=("paid_amount", "outstanding_amount", "paid_date", "payment_status", "modified_date"))
    return Response({"detail": f"{amount:.2f} collection saved successfully.", "balance": new_balance, "payment_status": installment.payment_status}, status=201)


@api_view(["GET"])
def collection_history(request):
    transactions = CollectionTransaction.objects.select_related("installment", "loan", "loan__customer", "loan__loan_type", "done_by_staff").order_by("-collection_date", "-id")
    search = request.query_params.get("search", "").strip().lower()
    mode = request.query_params.get("payment_mode", "").strip().lower()
    history_status = request.query_params.get("status", "").strip().upper()
    from_date = request.query_params.get("from", "")
    to_date = request.query_params.get("to", "")
    if from_date:
        transactions = transactions.filter(collection_date__gte=from_date)
    if to_date:
        transactions = transactions.filter(collection_date__lte=to_date)
    if mode:
        transactions = transactions.filter(payment_mode__iexact=mode)
    results = []
    for item in transactions:
        row = _collection_row(item.installment, timezone.localdate())
        if search and search not in f"{item.customer.full_name} {item.customer.customer_code} {item.customer.primary_mobile} {item.loan.loan_type.name} {item.loan.loan_no}".lower():
            continue
        if history_status and history_status != "ALL" and row["payment_status"] != history_status and not (history_status == "OVERDUE" and row["is_overdue"]):
            continue
        results.append({"id": item.id, "collection_date": item.collection_date, "due_date": item.installment.due_date, "customer_name": item.customer.full_name, "customer": item.customer.full_name, "loan_name": item.loan.loan_type.name, "loan_no": item.loan.loan_no, "due_amount": item.installment.installment_amount, "scheduled": item.installment.installment_amount, "scheduled_amount": item.installment.installment_amount, "collected_amount": item.collection_amount, "paid": item.collection_amount, "paid_amount": item.collection_amount, "total_paid": row["total_paid"], "balance": row["balance"], "status": row["payment_status"], "payment_mode": item.payment_mode, "reference_no": item.reference_no, "remarks": item.remarks, "done_by_staff": item.done_by_staff_id, "done_by_staff_name": item.done_by_staff.staff_name if item.done_by_staff else None})
    return Response({"count": len(results), "results": results})


@api_view(["GET", "POST"])
@permission_classes([CanWriteFinanceData])
def collections_endpoint(request):
    return collections_list(request) if request.method == "GET" else collections_create(request)


@api_view(["POST"])
@permission_classes([CanWriteFinanceData])
def collections_create_endpoint(request):
    return collections_create(request)


def _pending_report_rows(request, include_future=False, include_settled=False):
    """Dues eligible at the report cutoff, paid only by posted allocation history."""
    from rest_framework.exceptions import ValidationError
    raw = request.query_params.get("to")
    try:
        cutoff = date.fromisoformat(raw) if raw else timezone.localdate()
    except ValueError:
        raise ValidationError({"to": "Enter a valid To Date."})
    candidates = _filtered_installments(request, apply_status=False, include_future=include_future)
    if not include_future:
        candidates = candidates.filter(due_date__lte=cutoff)
    candidates = candidates.order_by("due_date", "pk").prefetch_related(
        Prefetch("collection_allocations", queryset=CollectionAllocation.objects.select_related("transaction")),
        Prefetch("collection_transactions", queryset=CollectionTransaction.objects.annotate(has_allocations=Exists(CollectionAllocation.objects.filter(transaction_id=OuterRef("pk")))))
    )
    status_filter = "" if include_settled else request.query_params.get("status", "").upper()
    for row in candidates:
        zero = Decimal("0.00")
        paid = sum((a.amount for a in row.collection_allocations.all() if a.transaction.collection_date <= cutoff), zero)
        paid += sum((t.collection_amount - t.advance_amount for t in row.collection_transactions.all() if not t.has_allocations and t.collection_date <= cutoff), zero)
        balance = max(zero, row.installment_amount - paid)
        if balance <= 0 and not include_settled:
            continue
        status = "PAID" if balance <= 0 else "OVERDUE" if row.due_date < cutoff else "PARTIAL" if paid > 0 else "UPCOMING"
        if status_filter == "PARTIAL" and paid <= 0:
            continue
        if status_filter in ("PAID", "PAID LATE"):
            continue
        if status_filter == "OVERDUE" and row.due_date >= cutoff:
            continue
        if status_filter == "PENDING" and status not in ("PENDING", "UPCOMING"):
            continue
        yield row, paid, balance, status, cutoff


@api_view(["GET"])
def day_wise_report(request):
    rows = _pending_report_rows(request, include_future=request.query_params.get("scope") == "all_pending")
    results = []
    for index, (row, paid, balance, status_value, cutoff) in enumerate(rows, 1):
        results.append({
            "s_no": index, "due_date": row.due_date, "customer": row.loan.customer.full_name,
            "customer_code": row.loan.customer.customer_code, "loan_id": row.loan_id,
            "loan_no": row.loan.loan_no or f"LN_{row.loan_id:06d}",
            "customer_type": row.loan.customer.get_role_display(), "phone": row.loan.customer.primary_mobile,
            "loan_type": row.loan.loan_type.name,
            "chit_group": getattr(getattr(getattr(row.loan, "chit_details", None), "chit_group", None), "name", None),
            "installment_no": row.installment_number, "installment_number": row.installment_number,
            "scheduled": row.installment_amount, "scheduled_amount": row.installment_amount,
            "paid": paid, "paid_amount": paid, "balance": balance,
            "days_overdue": max(0, (cutoff - row.due_date).days), "payment_date": row.paid_date if row.paid_date and row.paid_date <= cutoff else None, "penalty": row.penalty_amount, "status": status_value,
        })
    return Response({"summary": {
        "scheduled": sum((item["scheduled"] for item in results), Decimal("0")),
        "payable": sum((item["scheduled"] for item in results), Decimal("0")),
        "collected": sum((item["paid"] for item in results), Decimal("0")),
        "outstanding": sum((item["balance"] for item in results), Decimal("0")),
        "overdue": sum((item["balance"] for item in results if item["status"] == "OVERDUE"), Decimal("0")),
    }, "results": results})


@api_view(["GET"])
def loan_wise_report(request):
    if request.query_params.get("scope") == "total":
        return total_outstanding_report(request)
    grouped = {}
    for row, paid, balance, status_value, cutoff in _pending_report_rows(request):
        item = grouped.setdefault(row.loan_id, {
            "loan_id": row.loan_id, "loan_no": row.loan.loan_no or f"LN_{row.loan_id:06d}",
            "customer": row.loan.customer.full_name, "customer_code": row.loan.customer.customer_code,
            "start_date": row.loan.loan_start_date, "principal": row.loan.loan_amount,
            "total_payable": Decimal("0"), "due_date": row.due_date, "paid": Decimal("0"), "outstanding": Decimal("0"),
            "paid_installments": 0, "pending_installments": 0, "overdue": 0,
            "status": row.loan.loan_status, "installments": 0,
        })
        item["total_payable"] += row.installment_amount
        item["paid"] += paid
        item["outstanding"] += balance
        item["installments"] += 1
        item["paid_installments"] += status_value in ("PAID", "PAID LATE")
        item["pending_installments"] += status_value in ("PARTIAL", "UPCOMING")
        item["overdue"] += status_value == "OVERDUE"
    for item in grouped.values():
        item["remaining_installments"] = item["installments"] - item["paid_installments"]
    return Response({"summary": {"principal": sum((x["principal"] for x in grouped.values()), Decimal("0")), "payable": sum((x["total_payable"] for x in grouped.values()), Decimal("0")), "collected": sum((x["paid"] for x in grouped.values()), Decimal("0")), "outstanding": sum((x["outstanding"] for x in grouped.values()), Decimal("0"))}, "results": list(grouped.values())})


def total_outstanding_report(request):
    """All saved receivables, including future dues, with receipt balances at cutoff."""
    grouped = {}
    cutoff = timezone.localdate()
    for row, paid, balance, status, cutoff in _pending_report_rows(request, include_future=True, include_settled=True):
        item = grouped.setdefault(row.loan_id, {"loan_id":row.loan_id,"loan_no":row.loan.loan_no,"customer":row.loan.customer.full_name,
            "customer_code":row.loan.customer.customer_code,"principal":row.loan.loan_amount,"total_payable":Decimal("0"),
            "paid":Decimal("0"),"outstanding":Decimal("0"),"unallocated_others":Decimal("0"),"overdue_amount":Decimal("0"),"overdue":0,"days_overdue":0,"installments":[]})
        item["total_payable"] += row.installment_amount
        collections = [{"id": a.transaction_id, "date": a.transaction.collection_date, "voucher": f"RV-{a.transaction_id:06d}", "amount": a.amount, "particulars": "Collection"} for a in row.collection_allocations.all() if a.transaction.collection_date <= cutoff]
        collections += [{"id": t.pk, "date": t.collection_date, "voucher": f"RV-{t.pk:06d}", "amount": t.collection_amount-t.advance_amount, "particulars": "Collection"} for t in row.collection_transactions.all() if not t.has_allocations and t.collection_date <= cutoff]
        item["installments"].append({"id":row.pk,"installment_number":row.installment_number,"due_date":row.due_date,"create_date":row.create_date,"scheduled":row.installment_amount,"paid":paid,"balance":balance,"collections":collections})
        item["paid"] += min(row.installment_amount, paid)
        item["outstanding"] += balance
        if balance > 0 and row.due_date < cutoff:
            item["overdue"] += 1
            item["overdue_amount"] += balance
            item["days_overdue"] = max(item["days_overdue"],(cutoff-row.due_date).days)
    for receipt in CollectionTransaction.objects.filter(loan_id__in=grouped,collection_date__lte=cutoff).prefetch_related("allocations"):
        splits = list(receipt.allocations.all())
        allocated = sum((split.amount for split in splits),Decimal("0")) if splits else receipt.collection_amount-receipt.advance_amount
        grouped[receipt.loan_id]["unallocated_others"] += max(Decimal("0"),receipt.collection_amount-allocated)
    status = request.query_params.get("status", "").upper()
    rows = [row for row in grouped.values() if row["outstanding"]>0 or row["unallocated_others"]>0]
    if status == "OUTSTANDING": rows = [row for row in rows if row["outstanding"]>0]
    elif status == "OVERDUE": rows = [row for row in rows if row["overdue"]>0]
    elif status == "PARTIAL": rows = [row for row in rows if row["paid"]>0 and row["outstanding"]>0]
    elif status == "PENDING": rows = [row for row in rows if row["paid"]==0 and row["outstanding"]>0]
    elif status in ("PAID","PAID LATE"): rows = []
    return Response({"results":rows,"summary":{key:sum((row.get(field,Decimal("0")) for row in rows),Decimal("0")) for key,field in
        [("payable","total_payable"),("collected","paid"),("outstanding","outstanding"),("unallocated_others","unallocated_others"),("overdue","overdue_amount")]}})


@api_view(["GET"])
def customer_wise_report(request):
    """Customer ledger: Opening Balance first, every scheduled Chit/Interest/Mortgage
    installment due as a Debit (never reduced by a collection), every actual collection
    as a separate Credit, running as a day-book per customer."""
    from customers.models import Customer
    params = request.query_params
    from_date, to_date = _report_date_range(params)

    loans = CustomerLoanDetails.objects.select_related(
        "customer", "loan_type", "chit_details__chit_group",
    ).prefetch_related("installment_details", "collection_transactions").order_by("customer__full_name", "id")
    customer_param = params.get("customer", "").strip()
    if customer_param and customer_param.upper() != "ALL":
        loans = loans.filter(customer_id=customer_param)
    kind = params.get("loan_type", "").strip()
    if kind and kind.upper() != "ALL":
        loans = loans.filter(loan_type__name__iexact=kind)
    loan_id = params.get("loan_id", "").strip()
    if loan_id:
        loans = loans.filter(pk=loan_id)

    zero = Decimal("0.00")
    buckets = {}

    def bucket_for(customer):
        return buckets.setdefault(customer.id, {
            "customer": {"id": customer.id, "code": customer.customer_code, "name": customer.full_name, "phone": customer.primary_mobile},
            "entries": [],
        })

    if customer_param and customer_param.upper() != "ALL":
        selected = Customer.objects.filter(pk=customer_param).first()
        if selected:
            bucket_for(selected)

    today = timezone.localdate()
    # Chit/Interest/Mortgage schedules are generated and persisted for the loan's whole
    # future tenure the moment it's created, but a ledger only posts a due once it has
    # actually accrued â€” so cap at today unless the caller explicitly asks past it with `to`.
    due_cutoff = to_date if to_date else today
    for loan in loans:
        entry = bucket_for(loan.customer)
        chit = getattr(loan, "chit_details", None)
        group = chit.chit_group if chit else None
        kind_name = loan.loan_type.name
        if group:
            voucher_type = "Chit Installment"
            particulars = group.name
        else:
            voucher_type = kind_name
            particulars = f"{kind_name} Loan"
        for row in loan.installment_details.all():
            if row.due_date > due_cutoff:
                continue
            if from_date and row.due_date < from_date:
                continue
            entry["entries"].append({
                "date": row.due_date, "sort": (row.due_date, 0, loan.id, row.installment_number),
                "particulars": f"{particulars} (Inst #{row.installment_number})",
                "voucher_type": voucher_type, "loan_type": kind_name,
                "voucher_no": loan.doc_no or loan.loan_no or "",
                "debit": row.installment_amount or zero, "credit": zero,
            })
        for item in loan.collection_transactions.all():
            if item.collection_date > due_cutoff:
                continue
            if from_date and item.collection_date < from_date:
                continue
            entry["entries"].append({
                "date": item.collection_date, "sort": (item.collection_date, 1, loan.id, item.id),
                "particulars": "Receipt", "voucher_type": "Receipt", "loan_type": kind_name,
                "voucher_no": f"RV-{item.id:06d}",
                "debit": zero, "credit": item.collection_amount or zero,
            })

    # Customer = linked Party Ledger: the merged statement (no loan / loan-type filter) also
    # carries every other posting to that ledger -- Party Dues (Dr), Party / general
    # Collections (Cr), Journal lines and Payment Entries -- so it matches the ledger.
    if not loan_id and not (kind and kind.upper() != "ALL"):
        from .models import JournalLine, PartyCollection, PartyDue
        scope = {"customer_id": customer_param} if customer_param and customer_param.upper() != "ALL" else {"customer__isnull": False}
        party_ledgers = Ledger.objects.filter(**scope)
        customer_of = {ledger.id: ledger.customer for ledger in party_ledgers.select_related("customer")}

        def post(ledger_id, on, order, row_id, particulars, voucher_type, voucher_no, debit=zero, credit=zero):
            if on > due_cutoff or (from_date and on < from_date):
                return
            bucket_for(customer_of[ledger_id])["entries"].append({
                "date": on, "sort": (on, order, 0, row_id), "particulars": particulars, "voucher_type": voucher_type,
                "loan_type": "", "voucher_no": voucher_no, "debit": debit, "credit": credit})

        for due in PartyDue.objects.filter(party__in=party_ledgers).select_related("counter_ledger"):
            post(due.party_id, due.due_date, 2, due.id, f"{due.due_number} ({due.counter_ledger.name})", "Party Due", due.voucher_no, debit=due.amount)
        for receipt in PartyCollection.objects.filter(party__in=party_ledgers).select_related("account"):
            post(receipt.party_id, receipt.date, 3, receipt.id, f"Collection ({receipt.account.name})", "Receipt", receipt.voucher_no, credit=receipt.amount)
        for line in JournalLine.objects.filter(ledger__in=party_ledgers).select_related("voucher"):
            debit = line.side == JournalLine.DEBIT
            post(line.ledger_id, line.voucher.date, 4, line.id, line.voucher.narration or "Journal", "Journal", line.voucher.voucher_no,
                 debit=line.amount if debit else zero, credit=zero if debit else line.amount)
        for payment in PaymentEntry.objects.filter(ledger__in=party_ledgers).select_related("account"):
            post(payment.ledger_id, payment.date, 5, payment.id, f"Payment ({payment.account.name if payment.account else payment.payment_mode})", "Payment", f"PV-{payment.id:06d}", debit=payment.amount)

    ledger_balance = {}
    if buckets:
        for row in Ledger.objects.filter(customer_id__in=buckets.keys()):
            ledger_balance[row.customer_id] = ledger_balance.get(row.customer_id, zero) + (row.opening_balance or zero)

    results = []
    for customer_id, entry in buckets.items():
        rows = []
        debit_total = credit_total = zero
        if not loan_id:
            # Opening Balance is a customer-level ledger fact, not tied to any one loan â€”
            # only included in the merged (no loan_id) view, never repeated per loan.
            opening = ledger_balance.get(customer_id, zero)
            opening_debit = opening if opening >= 0 else zero
            opening_credit = -opening if opening < 0 else zero
            rows.append({
                "date": None, "particulars": "Opening Balance", "voucher_type": "Opening Balance", "loan_type": "",
                "voucher_no": "",
                "debit": opening_debit, "credit": opening_credit, "total": opening_debit + opening_credit,
                "is_opening": True,
            })
            debit_total, credit_total = opening_debit, opening_credit
        for item in sorted(entry["entries"], key=lambda row: row["sort"]):
            debit_total += item["debit"]
            credit_total += item["credit"]
            rows.append({
                "date": item["date"], "particulars": item["particulars"], "voucher_type": item["voucher_type"],
                "loan_type": item["loan_type"], "voucher_no": item["voucher_no"],
                "debit": item["debit"], "credit": item["credit"], "total": item["debit"] + item["credit"],
                "is_opening": False,
            })
        results.append({
            "customer": entry["customer"], "rows": rows,
            "totals": {"debit": debit_total, "credit": credit_total, "total": debit_total + credit_total},
        })
    results.sort(key=lambda item: item["customer"]["name"])

    customers = [{"id": row.id, "code": row.customer_code, "name": row.full_name}
                 for row in Customer.objects.order_by("full_name", "id").only("id", "customer_code", "full_name")]
    return Response({"customers": customers, "results": results})


TODAY_REPORT_TYPES = ("Loan", "Receipt", "Collection Entry", "Payment", "Bank Transaction")


@api_view(["GET"])
def today_report(request):
    """Read-only transaction register: every saved loan application (on its Loan Start Date),
    every saved collection receipt (on its collection date) and every Payment Entry (on its
    payment date). Built only from those source rows — never from installment schedules, so
    a due date alone never produces a receipt. Each source row appears exactly once, keyed by
    its type and primary key. `from`/`to` are inclusive business-local dates (default today)."""
    params = request.query_params
    today = timezone.localdate()
    try:
        from_date = date.fromisoformat(params["from"]) if params.get("from") else today
        to_date = date.fromisoformat(params["to"]) if params.get("to") else from_date
    except ValueError:
        return Response({"detail": "Enter valid report dates."}, status=400)
    if from_date > to_date:
        return Response({"detail": "From Date cannot be after To Date."}, status=400)
    kind = params.get("loan_type", "").strip()
    if kind.upper() == "ALL":
        kind = ""
    loan_id = params.get("loan_id", "").strip()
    if loan_id and not loan_id.isdigit():
        return Response({"detail": "Select a valid loan number."}, status=400)

    loans = CustomerLoanDetails.objects.select_related("customer", "loan_type").filter(loan_start_date__range=(from_date, to_date))
    receipts = CollectionTransaction.objects.select_related("customer", "loan__loan_type", "account").filter(collection_date__range=(from_date, to_date))
    if kind:
        loans = loans.filter(loan_type__name__iexact=kind)
        receipts = receipts.filter(loan__loan_type__name__iexact=kind)
    if loan_id:
        loans = loans.filter(pk=loan_id)
        receipts = receipts.filter(loan_id=loan_id)

    def loan_number(loan):
        return loan.doc_no or loan.loan_no or ""

    def account_type(item):
        # Cash / Bank comes from the linked Accounts ledger's category, never the
        # payment method name; only records without an account fall back to the mode.
        if item.account is not None and item.account.group in (CASH_GROUP, BANK_GROUP):
            return "Cash" if item.account.group == CASH_GROUP else "Bank"
        return "Cash" if is_cash_mode(item.payment_mode) else "Bank" if item.payment_mode else ""

    rows = []
    for loan in loans:
        rows.append({
            "key": f"LOAN-{loan.id}", "sort": (loan.loan_start_date, 0, loan.id),
            "date": loan.loan_start_date, "transaction_type": "Loan", "loan_type": loan.loan_type.name,
            "transaction_id": loan.id, "loan_id": loan.id, "loan_no": loan_number(loan), "customer": loan.customer.full_name,
            "particulars": f"{loan.customer.full_name} — {loan.loan_type.name} Loan Application",
            "voucher_no": loan_number(loan), "amount": loan.loan_amount,
            "party": loan.customer.full_name, "payment_mode": "", "account_type": "",
        })
    for item in receipts:
        rows.append({
            "key": f"RECEIPT-{item.id}", "sort": (item.collection_date, 1, item.id),
            "date": item.collection_date, "transaction_type": "Receipt", "loan_type": item.loan.loan_type.name,
            "transaction_id": item.id, "loan_id": item.loan_id, "loan_no": loan_number(item.loan), "customer": item.customer.full_name,
            "particulars": f"{item.customer.full_name} — Receipt ({item.payment_mode})",
            "voucher_no": f"RV-{item.id:06d}", "amount": item.collection_amount,
            "party": item.customer.full_name, "payment_mode": item.payment_mode or "", "account_type": account_type(item),
        })
    # Payment Entries carry no loan, so they only belong to the unscoped register: a Loan Type
    # or Loan Number filter selects loan-linked rows, which no payment can match.
    payments = PaymentEntry.objects.select_related("ledger__customer", "account").filter(date__range=(from_date, to_date))
    if kind or loan_id:
        payments = payments.none()
    for item in payments:
        customer = item.ledger.customer.full_name if item.ledger and item.ledger.customer else ""
        ledger_label = item.ledger.name if item.ledger else (item.ledger_group or "Payment")
        rows.append({
            "key": f"PAYMENT-{item.id}", "sort": (item.date, 2, item.id),
            "date": item.date, "transaction_type": "Payment", "loan_type": "",
            "transaction_id": item.id, "loan_id": None, "loan_no": "", "customer": customer,
            "particulars": f"{ledger_label} — Payment ({item.payment_mode})",
            "voucher_no": f"PV-{item.id:06d}", "amount": item.amount,
            "party": customer or ledger_label, "payment_mode": item.payment_mode or "", "account_type": account_type(item),
        })
    # Bank Transactions: one row per saved transfer (its Cr FROM / Dr TO postings are never
    # listed separately, so the amount counts once). Like payments they carry no loan.
    from .accounting_reports import bank_transfer_queryset
    transfers = bank_transfer_queryset().select_related("from_account", "to_account").filter(date__range=(from_date, to_date))
    if kind or loan_id:
        transfers = transfers.none()
    for item in transfers:
        route = f"{item.from_account.name} → {item.to_account.name}"
        # Cash when either side is the Cash in Hand account (deposit / withdrawal), Bank for bank-to-bank.
        involves_cash = CASH_GROUP in (item.from_account.group, item.to_account.group)
        rows.append({
            "key": f"TRANSFER-{item.id}", "sort": (item.date, 3, item.id),
            "date": item.date, "transaction_type": "Bank Transaction", "loan_type": "",
            "transaction_id": item.id, "loan_id": None, "loan_no": "", "customer": "",
            "particulars": route, "voucher_no": item.voucher_no, "amount": item.amount,
            "party": route, "payment_mode": item.payment_mode or "", "account_type": "Cash" if involves_cash else "Bank",
        })
    # Party Collection receipts: one row per voucher (its due allocations are never listed),
    # shown as Collection Entry. Like payments they carry no loan.
    from .models import PartyCollection
    party_receipts = PartyCollection.objects.select_related("party", "account").filter(date__range=(from_date, to_date))
    if kind or loan_id:
        party_receipts = party_receipts.none()
    for item in party_receipts:
        rows.append({
            "key": f"PARTYCOLLECTION-{item.id}", "sort": (item.date, 1, item.id),
            "date": item.date, "transaction_type": "Collection Entry", "loan_type": "",
            "transaction_id": item.id, "loan_id": None, "loan_no": "", "customer": "",
            "particulars": f"{item.party.name} — {'Party Collection' if item.party.collection_type else 'Collection'}", "voucher_no": item.voucher_no, "amount": item.amount,
            "party": item.party.name, "payment_mode": item.payment_mode or "", "account_type": account_type(item),
        })
    rows.sort(key=lambda row: row["sort"])
    # Attachment counts only for users allowed to open documents (admin or Entry access) —
    # view-only users get the register without any document metadata. Counted through
    # subqueries on the same filtered sets (no id lists: SQL Server caps parameters at 2100).
    documents_allowed = CanAccessKycDocuments().has_permission(request, None)
    counts = {}
    if documents_allowed:
        for prefix, queryset, field in (
                ("LOAN", LoanKycDocument.objects.filter(loan__in=loans.values("pk")), "loan_id"),
                ("RECEIPT", TransactionDocument.objects.filter(collection__in=receipts.values("pk")), "collection_id"),
                ("PAYMENT", TransactionDocument.objects.filter(payment__in=payments.values("pk")), "payment_id")):
            for owner_id, number in queryset.order_by().values_list(field).annotate(number=Count("id")):
                counts[f"{prefix}-{owner_id}"] = number
    for row in rows:
        del row["sort"]
        # Bank Transactions take no attachments, so they carry no document metadata.
        row["document_count"] = counts.get(row["key"], 0) if documents_allowed and row["transaction_type"] not in ("Bank Transaction", "Collection Entry") else None
    totals = {name: {"count": 0, "amount": Decimal("0.00")} for name in TODAY_REPORT_TYPES}
    for row in rows:
        totals[row["transaction_type"]]["count"] += 1
        totals[row["transaction_type"]]["amount"] += row["amount"] or Decimal("0.00")
    return Response({"from": from_date, "to": to_date, "count": len(rows), "rows": rows, "totals": totals,
                     "documents_allowed": documents_allowed})


def _pending_as_of(row, as_of):
    """Pending balance of one schedule installment as of `as_of`, from saved collections only.
    Same attribution as the collection editor: a receipt's CollectionAllocation rows are
    authoritative; an older receipt without allocations counts against its own installment.
    Collections dated after `as_of` are not yet paid then, and the adjustment (penalty) a
    later receipt added to this installment is not yet owed. Any stored paid amount that no
    saved receipt explains is treated as paid, so a settled installment never reappears."""
    zero = Decimal("0.00")
    allocations = list(row.collection_allocations.all())
    legacy = [item for item in row.collection_transactions.all() if not item.has_allocations]
    traced = sum((a.amount for a in allocations), zero) + sum((t.collection_amount - t.advance_amount for t in legacy), zero)
    paid = (sum((a.amount for a in allocations if a.transaction.collection_date <= as_of), zero)
            + sum((t.collection_amount - t.advance_amount for t in legacy if t.collection_date <= as_of), zero)
            + max(zero, (row.paid_amount or zero) - traced))
    later_adjustments = sum((t.adjustment_amount or zero for t in row.collection_transactions.all() if t.collection_date > as_of), zero)
    penalty = max(zero, (row.penalty_amount or zero) - later_adjustments)
    due = (row.installment_amount or zero) + penalty
    return due, min(paid, due), max(zero, due - paid)


def _installment_receipts(row, as_of):
    """Saved receipts that paid this installment on or before `as_of`, oldest first, each with
    the amount allocated to THIS installment (allocation rows are authoritative; an older
    receipt without allocations counts against its own installment). Deleted receipts no
    longer exist, so they are never counted."""
    entries = [(a.transaction, a.amount) for a in row.collection_allocations.all() if a.transaction.collection_date <= as_of]
    entries += [(t, t.collection_amount - t.advance_amount) for t in row.collection_transactions.all() if not t.has_allocations and t.collection_date <= as_of and t.collection_amount > t.advance_amount]
    entries.sort(key=lambda item: (item[0].collection_date, item[0].pk))
    return [{
        "collection_id": receipt.pk, "voucher_no": receipt_voucher_no(receipt), "date": receipt.collection_date,
        "amount": amount, "receipt_amount": receipt.collection_amount, "payment_mode": receipt.payment_mode,
        "account": receipt.account.name if receipt.account_id else "", "ledger": receipt.ledger.name if receipt.ledger_id else (receipt.ledger_group or ""),
        "notes": receipt.remarks or "", "reference_no": receipt.reference_no or "",
    } for receipt, amount in entries]


@api_view(["GET"])
def today_collection_report(request):
    """Collection dues as of a report date, one row per schedule installment (so nothing is
    counted twice): every installment due on or before it with a balance still above zero,
    plus every installment that received a saved collection within the period (so a due
    settled in the period shows as Completed). RECEIVED = saved collections allocated to the
    installment up to the as-of date, BALANCE = MAX(0, DUE − RECEIVED), STATUS = Completed /
    Partial / Pending. Payment Entries never appear, and a due date alone is never a receipt.
    The as-of date is the period end, capped at today."""
    params = request.query_params
    today = timezone.localdate()
    try:
        all_time = params.get("all_time") == "true"
        from_date = date.min if all_time else date.fromisoformat(params["from"]) if params.get("from") else today
        to_date = date.fromisoformat(params["to"]) if params.get("to") else today if all_time else from_date
    except ValueError:
        return Response({"detail": "Enter valid report dates."}, status=400)
    if from_date > to_date:
        return Response({"detail": "From Date cannot be after To Date."}, status=400)
    as_of = min(to_date, today)
    kind = params.get("loan_type", "").strip()
    loan_id = params.get("loan_id", "").strip()
    if loan_id and not loan_id.isdigit():
        return Response({"detail": "Select a valid loan number."}, status=400)

    receipts = (CollectionTransaction.objects.select_related("account", "ledger")
                .annotate(has_allocations=Exists(CollectionAllocation.objects.filter(transaction=OuterRef("pk")))))
    # Settled on or before the as-of date can be skipped in SQL unless collected in the period.
    unsettled = Q(due_date__lte=as_of) & (Q(paid_amount__lt=F("installment_amount") + F("penalty_amount")) | Q(paid_date__isnull=True) | Q(paid_date__gt=as_of))
    collected_in_period = (Q(collection_allocations__transaction__collection_date__gte=from_date, collection_allocations__transaction__collection_date__lte=as_of)
                           | Q(collection_transactions__collection_date__gte=from_date, collection_transactions__collection_date__lte=as_of))
    ids = CustomerLoanInstallmentDetails.objects.filter(unsettled | collected_in_period)
    if kind and kind.upper() != "ALL":
        ids = ids.filter(loan__loan_type__name__iexact=kind)
    if loan_id:
        ids = ids.filter(loan_id=loan_id)
    installments = (CustomerLoanInstallmentDetails.objects.filter(pk__in=ids.values("pk"))
        .select_related("loan", "loan__customer", "loan__loan_type", "loan__chit_details__chit_group")
        .prefetch_related(Prefetch("collection_allocations", queryset=CollectionAllocation.objects.select_related("transaction__account", "transaction__ledger")),
                          Prefetch("collection_transactions", queryset=receipts))
        .order_by("due_date", "loan_id", "installment_number"))

    documents_allowed = CanAccessKycDocuments().has_permission(request, None)
    rows = []
    for row in installments:
        due, paid, pending = _pending_as_of(row, as_of)
        history = _installment_receipts(row, as_of)
        in_period = any(from_date <= item["date"] <= as_of for item in history)
        if pending <= 0 and not in_period:
            continue
        status = "Completed" if pending <= 0 else "Partial" if paid > 0 else "Pending"
        loan = row.loan
        customer = loan.customer
        chit = getattr(loan, "chit_details", None)
        plan = chit.chit_group.name if chit else f"{loan.loan_type.name} Loan"
        due_days = (as_of - row.due_date).days
        loan_no = loan.doc_no or loan.loan_no or ""
        latest = history[-1] if history else None
        address = ", ".join(part for part in (customer.address, customer.district, getattr(customer, "state", "") or "") if part)
        if customer.pincode:
            address = f"{address} - {customer.pincode}" if address else customer.pincode
        rows.append({
            "key": f"INSTALLMENT-{row.id}", "transaction_id": loan.id, "document_kind": "loan",
            "installment_id": row.id, "installment_number": row.installment_number,
            "date": row.due_date, "transaction_type": "Overdue" if due_days > 0 else "Due Today" if due_days == 0 else "Advance",
            "loan_type": loan.loan_type.name, "loan_id": loan.id, "loan_no": loan_no,
            "customer": customer.full_name,
            "particulars": f"{customer.full_name} — {plan} (Inst #{row.installment_number})",
            "voucher_no": f"{loan_no} · Inst #{row.installment_number}",
            "due_amount": due, "paid_amount": paid, "received_amount": paid, "balance_amount": pending, "amount": pending,
            "status": status, "due_days": max(0, due_days) if pending > 0 else 0,
            "customer_id": customer.id, "customer_code": customer.customer_code, "customer_phone": customer.primary_mobile or "",
            "customer_address": address, "plan_name": plan, "loan_start_date": loan.loan_start_date,
            "collection": latest, "collections": history,
        })
    # Documents are the loan's own KYC documents (the existing model has no installment link).
    counts = dict(LoanKycDocument.objects.order_by().values_list("loan_id").annotate(number=Count("id"))) if documents_allowed else {}
    for row in rows:
        row["document_count"] = counts.get(row["loan_id"], 0) if documents_allowed else None
    return Response({"from": from_date, "to": to_date, "as_of": as_of, "count": len(rows), "rows": rows,
                     "documents_allowed": documents_allowed})


@api_view(["GET"])
def group_wise_report(request):
    """Read-only customer-wise loan report across all loan types, grouped by customer with
    full per-loan schedule/payment detail. Powers Group-wise Report, which slices this same
    rich payload down to one Chit Group's member customers/loans on the client."""
    from customers.models import Customer
    params = request.query_params
    from_date, to_date = _report_date_range(params)
    loans = CustomerLoanDetails.objects.select_related(
        "customer", "loan_type", "chit_details__chit_group", "interest_details__loan_installment", "mortgage_details",
    ).prefetch_related("installment_details", "collection_transactions__installment").order_by("customer__full_name", "id")
    customer_id = params.get("customer", "").strip()
    if customer_id and customer_id.upper() != "ALL":
        loans = loans.filter(customer_id=customer_id)
    kind = params.get("loan_type", "").strip()
    if kind and kind.upper() != "ALL":
        loans = loans.filter(loan_type__name__iexact=kind)
    if from_date:
        loans = loans.filter(loan_start_date__gte=from_date)
    if to_date:
        loans = loans.filter(loan_start_date__lte=to_date)
    status_filter = params.get("status", "").strip().upper()
    today = timezone.localdate()
    zero = Decimal("0.00")
    grouped = {}
    for loan in loans:
        installments = sorted(loan.installment_details.all(), key=lambda row: (row.due_date, row.installment_number))
        paid_total = sum((row.paid_amount for row in installments), zero)
        total = loan.total_amount or sum((row.installment_amount for row in installments), zero)
        remaining = max(zero, total - paid_total)
        unpaid = [row for row in installments if row.paid_amount < row.installment_amount]
        overdue = [row for row in unpaid if row.due_date < today]
        status = "Completed" if remaining <= 0 and installments else "Overdue" if overdue else "Active"
        if status_filter == "COMPLETED" and status != "Completed":
            continue
        if status_filter == "ACTIVE" and status == "Completed":
            continue
        next_due = (overdue or unpaid)[0] if unpaid else None
        chit = getattr(loan, "chit_details", None)
        interest = getattr(loan, "interest_details", None)
        mortgage = getattr(loan, "mortgage_details", None)
        group = chit.chit_group if chit else None
        collection_date = (group.collection_date if group else None) or (interest.collection_date if interest else None) or (next_due.due_date if next_due else None)
        schedule = [{
            "installment_number": row.installment_number, "due_date": row.due_date,
            "installment_amount": row.installment_amount, "paid_amount": row.paid_amount,
            "balance": max(zero, row.installment_amount - row.paid_amount), "paid_date": row.paid_date,
            "status": "Paid" if row.paid_amount >= row.installment_amount else "Overdue" if row.due_date < today else "Partial" if row.paid_amount > 0 else "Pending",
        } for row in installments]
        transactions = sorted(loan.collection_transactions.all(), key=lambda item: (item.collection_date, item.id))
        payments = [{
            "date": item.collection_date, "amount": item.collection_amount, "payment_mode": item.payment_mode,
            "reference_no": item.reference_no, "installment_number": item.installment.installment_number,
        } for item in transactions] or [{
            "date": row.paid_date, "amount": row.paid_amount, "payment_mode": "", "reference_no": "",
            "installment_number": row.installment_number,
        } for row in installments if row.paid_amount > 0]
        item = {
            "id": loan.id, "doc_no": loan.doc_no or loan.loan_no, "loan_type": loan.loan_type.name, "status": status,
            "start_date": loan.loan_start_date, "end_date": loan.loan_end_date, "collection_date": collection_date,
            "next_due_date": next_due.due_date if next_due else None,
            "loan_amount": loan.loan_amount, "total_amount": total, "total_paid": paid_total, "remaining": remaining,
            "total_installments": len(installments),
            "paid_installments": sum(1 for row in installments if row.paid_amount >= row.installment_amount),
            "pending_installments": len(unpaid),
            "chit": {"group_code": group.code, "group_name": group.name, "chit_amount": loan.loan_amount or group.grand_total} if group else None,
            "interest": {"principal": interest.principal_amount, "interest_percentage": interest.interest_percentage,
                         "interest_amount": interest.interest_amount, "collection_plan": interest.loan_installment.name,
                         "installment_amount": interest.installment_amount} if interest else None,
            "mortgage": {"product_name": mortgage.product_name, "quantity": mortgage.quantity, "unit": mortgage.unit,
                         "current_rate": mortgage.current_rate, "market_value": mortgage.market_value,
                         "loan_amount": mortgage.loan_amount, "interest_percentage": mortgage.interest_percentage,
                         "daily_interest_amount": mortgage.daily_interest_amount} if mortgage else None,
            "schedule": schedule, "payments": payments,
        }
        customer = loan.customer
        entry = grouped.setdefault(customer.id, {"customer": {"id": customer.id, "code": customer.customer_code, "name": customer.full_name, "phone": customer.primary_mobile}, "loans": []})
        entry["loans"].append(item)
    customers = [{"id": row.id, "code": row.customer_code, "name": row.full_name}
                 for row in Customer.objects.order_by("full_name", "id").only("id", "customer_code", "full_name")]
    return Response({"customers": customers, "results": list(grouped.values())})


LEDGER_REPORT_GROUPS = {"cash": "Cash-in-Hand", "bank": "Bank Accounts"}


def _signed(value):
    """Split a signed balance into a display amount and its DR/CR type (positive = DR, negative = CR)."""
    value = value if value is not None else Decimal("0.00")
    return (abs(value), "CR" if value < 0 else "DR")


@api_view(["GET"])
def ledger_statement(request):
    """Ledger statement, running from the Opening Balance (positive = Dr, negative = Cr).
    type=cash / type=bank: every Cash-in-Hand / Bank Accounts ledger together.
    type=ledger&ledger=<id>: one ledger (e.g. a party), with every posting that touches it.
    Rows mirror accounting_reports.ledger_balances, so closing balances match Trial Balance."""
    params = request.query_params
    kind = params.get("type", "").strip().lower()
    from_date, to_date = _report_date_range(params)

    from .accounting_reports import _group_lookup, _root_of, bank_transfer_queryset, report_warnings
    if kind == "ledger":
        ledger_param = str(params.get("ledger", "")).strip()
        single = Ledger.objects.filter(pk=ledger_param).first() if ledger_param.isdigit() else None
        if single is None:
            return Response({"detail": "Select a valid ledger."}, status=400)
        ledgers, group_name = [single], single.group
    else:
        group_name = LEDGER_REPORT_GROUPS.get(kind)
        if not group_name:
            return Response({"detail": "type must be 'cash', 'bank' or 'ledger'."}, status=400)
        groups = _group_lookup()
        ledgers = [item for item in Ledger.objects.all() if item.group == group_name or
                   (item.group_detail_id in groups and
                    getattr(_root_of(groups[item.group_detail_id], groups), "name", None) == group_name)]
    ledger_ids = [item.id for item in ledgers]
    opening_balance = sum((item.opening_balance or Decimal("0.00") for item in ledgers), Decimal("0.00"))

    zero = Decimal("0.00")
    entries = []
    collections = CollectionTransaction.objects.filter(Q(account_id__in=ledger_ids) | Q(party_ledger_id__in=ledger_ids) | Q(ledger_id__in=ledger_ids)).select_related("customer", "loan")
    for item in collections:
        amount, ledger_amount = item.collection_amount or zero, item.ledger_amount or zero
        # Dr Cash/Bank; Cr the party ledger (and any legacy "Other Charges" ledger share).
        credit = (amount - ledger_amount if item.party_ledger_id in ledger_ids else zero) + (ledger_amount if item.ledger_id in ledger_ids else zero)
        entries.append({
            "date": item.collection_date, "sort": (item.collection_date, item.id, 0),
            "particulars": f"{item.customer.full_name} · Collection ({item.loan.loan_no})",
            "reference": f"RV-{item.id:06d}", "type": "Collection Entry",
            "debit": amount if item.account_id in ledger_ids else zero, "credit": credit,
        })
    payments = PaymentEntry.objects.filter(Q(account_id__in=ledger_ids) | Q(ledger_id__in=ledger_ids)).select_related("ledger", "account")
    for item in payments:
        entries.append({
            "date": item.date, "sort": (item.date, item.id, 1),
            # Seen from Cash/Bank: the ledger paid; seen from the ledger paid: the account paid from.
            "particulars": (f"Paid from {item.account.name}" if item.ledger_id in ledger_ids and item.account else
                            item.ledger.name if item.ledger else item.ledger_group) or "Payment Entry",
            "reference": f"PV-{item.id:06d}", "type": "Payment Entry",
            "debit": item.amount if item.ledger_id in ledger_ids else zero, "credit": item.amount if item.account_id in ledger_ids else zero,
        })
    from .models import JournalLine, PartyCollection, PartyDue
    for item in PartyCollection.objects.filter(Q(account_id__in=ledger_ids) | Q(party_id__in=ledger_ids)).select_related("party", "account").annotate(allocated_total=Sum("allocations__amount")):
        label = "Collection" if item.allocated_total else "Others Collection"
        entries.append({
            "date": item.date, "sort": (item.date, item.id, 3),
            "particulars": f"{item.party.name} - {label}" if item.account_id in ledger_ids else f"{label} - {item.account.name}",
            "reference": item.voucher_no, "type": "Collection Entry",
            "debit": item.amount if item.account_id in ledger_ids else zero, "credit": item.amount if item.party_id in ledger_ids else zero,
        })
    for item in PartyDue.objects.filter(Q(party_id__in=ledger_ids) | Q(counter_ledger_id__in=ledger_ids)).select_related("party", "counter_ledger"):
        entries.append({
            "date": item.due_date, "sort": (item.due_date, item.id, 4),
            "particulars": item.due_number if item.party_id in ledger_ids else f"{item.party.name} · {item.due_number}",
            "reference": item.voucher_no, "type": "Due",
            "debit": item.amount if item.party_id in ledger_ids else zero, "credit": item.amount if item.counter_ledger_id in ledger_ids else zero,
        })
    # Journal Entry: one row per posting line, named after the ledgers on the other side.
    journal_lines = JournalLine.objects.filter(voucher__in=JournalLine.objects.filter(ledger_id__in=ledger_ids).values("voucher_id")).select_related("voucher", "ledger")
    by_voucher = {}
    for line in journal_lines:
        by_voucher.setdefault(line.voucher_id, []).append(line)
    for lines in by_voucher.values():
        for line in lines:
            if line.ledger_id not in ledger_ids:
                continue
            others = sorted({other.ledger.name for other in lines if other.side != line.side})
            entries.append({
                "date": line.voucher.date, "sort": (line.voucher.date, line.voucher_id, 5, line.row),
                "particulars": f"Journal · {', '.join(others)}" + (f" ({line.voucher.narration})" if line.voucher.narration else ""),
                "reference": line.voucher.voucher_no, "type": "Journal",
                "debit": line.amount if line.side == JournalLine.DEBIT else zero, "credit": line.amount if line.side == JournalLine.CREDIT else zero,
            })
    from .models import BankTransfer
    transfers = bank_transfer_queryset().filter(Q(from_account_id__in=ledger_ids) | Q(to_account_id__in=ledger_ids)).select_related('from_account', 'to_account')
    for item in transfers:
        entries.append({
            "date": item.date, "sort": (item.date, item.id, 2),
            "particulars": f"{item.from_account.name} -> {item.to_account.name}",
            "reference": item.voucher_no, "type": item.get_transaction_type_display(),
            "debit": item.amount if item.to_account_id in ledger_ids else zero,
            "credit": item.amount if item.from_account_id in ledger_ids else zero,
        })
    entries.sort(key=lambda row: row["sort"])

    before_range = [row for row in entries if from_date and row["date"] < from_date]
    opening_for_range = opening_balance + sum((row["debit"] for row in before_range), zero) - sum((row["credit"] for row in before_range), zero)

    visible = [row for row in entries
               if (not from_date or row["date"] >= from_date) and (not to_date or row["date"] <= to_date)]

    running = opening_for_range
    rows = []
    total_debit = total_credit = zero
    for row in visible:
        running += row["debit"] - row["credit"]
        total_debit += row["debit"]
        total_credit += row["credit"]
        balance_amount, balance_type = _signed(running)
        rows.append({
            "date": row["date"], "particulars": row["particulars"], "reference": row["reference"],
            "type": row["type"], "debit": row["debit"], "credit": row["credit"],
            "balance": balance_amount, "balance_type": balance_type,
        })

    opening_amount, opening_type = _signed(opening_for_range)
    closing_amount, closing_type = _signed(running)
    return Response({
        "ledger_type": kind, "group": group_name, "ledger_name": ledgers[0].name if kind == "ledger" else "", "warnings": report_warnings(),
        "opening_balance": opening_amount, "opening_balance_type": opening_type,
        "rows": rows, "total_debit": total_debit, "total_credit": total_credit,
        "closing_balance": closing_amount, "closing_balance_type": closing_type,
    })


def _report_date_range(params):
    from rest_framework.exceptions import ValidationError
    try:
        start = date.fromisoformat(params["from"]) if params.get("from") else None
        end = date.fromisoformat(params["to"]) if params.get("to") else None
    except (ValueError, TypeError):
        raise ValidationError({"detail": "Enter valid report dates."})
    if start and end and start > end:
        raise ValidationError({"detail": "From Date cannot be after To Date."})
    return start, end


@api_view(["GET"])
def trial_balance_report(request):
    from .accounting_reports import trial_balance
    from_date, to_date = _report_date_range(request.query_params)
    from .accounting_reports import report_warnings
    return Response({**trial_balance(from_date, to_date), "warnings": report_warnings()})


@api_view(["GET"])
def profit_and_loss_report(request):
    from .accounting_reports import profit_and_loss
    from_date, to_date = _report_date_range(request.query_params)
    from .accounting_reports import report_warnings
    return Response({**profit_and_loss(from_date, to_date), "warnings": report_warnings()})


@api_view(["GET"])
def balance_sheet_report(request):
    from .accounting_reports import balance_sheet
    from_date, to_date = _report_date_range(request.query_params)
    from .accounting_reports import report_warnings
    return Response({**balance_sheet(from_date, to_date), "warnings": report_warnings()})


@api_view(["GET", "POST"])
@permission_classes([CanAccessKycDocuments])
def loan_kyc_documents(request, loan_id):
    loan = get_object_or_404(CustomerLoanDetails, pk=loan_id)
    if request.method == "POST":
        serializer = LoanKycDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(loan=loan)
        return Response(serializer.data, status=201)
    documents = loan.kyc_documents.all()
    return Response(LoanKycDocumentSerializer(documents, many=True).data)


@api_view(["GET"])
@permission_classes([CanAccessKycDocuments])
def loan_kyc_document_file(request, loan_id, document_id):
    # Scoped to the loan id in the path, not just the document id, so one loan's
    # document link can never be swapped onto another loan â€” same guarantee as the
    # customer-level KYC file endpoint.
    document = get_object_or_404(LoanKycDocument, pk=document_id, loan_id=loan_id)
    try:
        handle = document.file.open("rb")
    except FileNotFoundError:
        raise Http404("Document file is missing.")
    response = FileResponse(handle, as_attachment=bool(request.query_params.get("download")),
                            filename=document.original_file_name,
                            content_type=document.file_type or "application/octet-stream")
    return secure_kyc_response(response)


# Today Report attachments for a saved Receipt or Payment Entry (Loan rows use the loan KYC
# endpoints above). Same access rule as loan KYC: administrators or users with Entry access.
TRANSACTION_DOCUMENT_OWNERS = {"receipt": ("collection", CollectionTransaction), "payment": ("payment", PaymentEntry)}


def _transaction_document_owner(kind, transaction_id):
    if kind not in TRANSACTION_DOCUMENT_OWNERS:
        raise Http404("Unknown transaction type.")
    field, model = TRANSACTION_DOCUMENT_OWNERS[kind]
    return field, get_object_or_404(model, pk=transaction_id)


@api_view(["GET", "POST"])
@permission_classes([CanAccessKycDocuments])
def transaction_documents(request, kind, transaction_id):
    field, owner = _transaction_document_owner(kind, transaction_id)
    if request.method == "POST":
        serializer = TransactionDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Only the document row is written; the receipt/payment itself is never saved here.
        serializer.save(**{field: owner})
        return Response(serializer.data, status=201)
    documents = TransactionDocument.objects.filter(**{field: owner})
    return Response(TransactionDocumentSerializer(documents, many=True).data)


@api_view(["GET"])
@permission_classes([CanAccessKycDocuments])
def transaction_document_file(request, kind, transaction_id, document_id):
    # Scoped to the owning transaction in the path, so one receipt's document id can never be
    # read through another receipt or payment of the same customer or loan.
    field, owner = _transaction_document_owner(kind, transaction_id)
    document = get_object_or_404(TransactionDocument, pk=document_id, **{field: owner})
    try:
        handle = document.file.open("rb")
    except FileNotFoundError:
        raise Http404("Document file is missing.")
    response = FileResponse(handle, as_attachment=bool(request.query_params.get("download")),
                            filename=document.original_file_name,
                            content_type=document.file_type or "application/octet-stream")
    return secure_kyc_response(response)
