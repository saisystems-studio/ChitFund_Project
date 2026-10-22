import os
import uuid
from decimal import Decimal
from django.db import models
from django.db import transaction
from django.utils import timezone

from customers.models import CustomerKycDocument
from customers.kyc_security import private_kyc_storage


MONEY = {"max_digits": 18, "decimal_places": 2, "default": Decimal("0.00")}


class AuditModel(models.Model):
    created_by = models.CharField(max_length=100, null=True, blank=True, db_column="CreatedBy")
    create_date = models.DateTimeField(auto_now_add=True, null=True, db_column="CreateDate")
    modified_by = models.CharField(max_length=100, null=True, blank=True, db_column="ModifiedBy")
    modified_date = models.DateTimeField(auto_now=True, null=True, db_column="ModifiedDate")

    class Meta:
        abstract = True

class LoanType(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    name = models.CharField(max_length=100, unique=True, db_column="LoanTypeName")
    # JSON array of LoanInstallment_tbl IDs. Kept on the master row to honor
    # the project's fixed-table constraint.
    allowed_installment_ids = models.TextField(default="[]", db_column="AllowedInstallmentIDs")
    repeat_type = models.CharField(max_length=20, blank=True, default="", db_column="RepeatType")
    due_month = models.PositiveSmallIntegerField(null=True, blank=True, db_column="DueMonth")
    due_day = models.PositiveSmallIntegerField(null=True, blank=True, db_column="DueDay")
    is_active = models.BooleanField(default=True, db_column="IsActive")
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")

    class Meta:
        db_table = "LoanType_tbl"


class LoanInstallment(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    name = models.CharField(max_length=100, unique=True, db_column="InstallmentName")
    code = models.CharField(max_length=30, unique=True, db_column="InstallmentCode")
    is_active = models.BooleanField(default=True, db_column="IsActive")

    class Meta:
        db_table = "LoanInstallment_tbl"


class Mortgage(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    product_group = models.CharField(max_length=50, blank=True, default="", db_column="ProductGroup")
    product_name = models.CharField(max_length=150, unique=True, db_column="ProductName")
    hsn_code = models.CharField(max_length=30, blank=True, default="", db_column="HSNCode")
    rate_of_tax = models.PositiveSmallIntegerField(default=0, choices=[(value, f"{value}%") for value in (0, 5, 12, 18, 28)], db_column="RateOfTax")
    quantity = models.DecimalField(max_digits=18, decimal_places=3, null=True, blank=True, db_column="Quantity")
    unit = models.CharField(max_length=50, db_column="Unit")
    uqc = models.CharField(max_length=20, blank=True, default="", db_column="UQC")
    current_rate = models.DecimalField(**MONEY, db_column="CurrentRate")
    is_active = models.BooleanField(default=True, db_column="IsActive")
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")

    class Meta:
        db_table = "Mortgage_tbl"
        ordering = ("product_name",)


class ChitGroup(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    code = models.CharField(max_length=20, unique=True, db_column="ChitGroupCode")
    name = models.CharField(max_length=150, db_column="ChitGroupName")
    duration_type = models.CharField(max_length=10, db_column="DurationType")
    duration = models.PositiveIntegerField(db_column="Duration")
    start_date = models.DateField(null=True, blank=True, db_column="StartDate")
    collection_date = models.DateField(null=True, blank=True, db_column="CollectionDate")
    end_date = models.DateField(null=True, blank=True, db_column="EndDate")
    collection_day = models.PositiveSmallIntegerField(null=True, blank=True, db_column="CollectionDay")
    collection_month = models.PositiveSmallIntegerField(null=True, blank=True, db_column="CollectionMonth")
    grand_total = models.DecimalField(**MONEY, db_column="GrandTotal")
    is_active = models.BooleanField(default=True, db_column="IsActive")
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")

    class Meta:
        db_table = "ChitGroup_tbl"


class ChitGroupInstallmentDetail(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    group = models.ForeignKey(ChitGroup, on_delete=models.CASCADE, related_name="installments", db_column="ChitGroupID")
    installment_number = models.PositiveIntegerField(db_column="InstallmentNo")
    schedule_value = models.CharField(max_length=100, db_column="ScheduleValue")
    installment_amount = models.DecimalField(**MONEY, db_column="InstallmentAmount")

    class Meta:
        db_table = "ChitGroup_InstallmentDetails_tbl"
        constraints = [models.UniqueConstraint(fields=("group", "installment_number"), name="uniq_chit_group_installment")]


class CustomerLoanDetails(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    loan_no = models.CharField(max_length=30, unique=True, null=True, blank=True, db_column="LoanNo")
    doc_no = models.CharField(max_length=30, unique=True, default='', editable=False, db_column="DocNo")
    application_date = models.DateField(default=timezone.localdate, editable=False, db_column="ApplicationDate")
    customer = models.ForeignKey("customers.Customer", on_delete=models.PROTECT, related_name="customer_loans", db_column="CustomerID")
    loan_type = models.ForeignKey(LoanType, on_delete=models.PROTECT, db_column="LoanTypeID")
    loan_amount = models.DecimalField(**MONEY, db_column="LoanAmount")
    loan_start_date = models.DateField(db_column="LoanStartDate")
    loan_end_date = models.DateField(null=True, blank=True, db_column="LoanEndDate")
    total_amount = models.DecimalField(**MONEY, db_column="TotalAmount")
    paid_amount = models.DecimalField(**MONEY, db_column="PaidAmount")
    penalty_amount = models.DecimalField(**MONEY, db_column="PenaltyAmount")
    outstanding_amount = models.DecimalField(**MONEY, db_column="OutstandingAmount")
    loan_status = models.CharField(max_length=20, default="ACTIVE", db_column="LoanStatus")
    is_active = models.BooleanField(default=True, db_column="IsActive")
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")

    class Meta:
        db_table = "CustomerLoanDetails_tbl"

    def save(self, *args, **kwargs):
        if self._state.adding:
            from .services import next_document_number
            with transaction.atomic():
                self.application_date = timezone.localdate()
                self.doc_no = next_document_number(self.loan_type)
                if not self.loan_no:
                    self.loan_no = self.doc_no
                return super().save(*args, **kwargs)
        return super().save(*args, **kwargs)


def loan_kyc_document_upload_path(instance, filename):
    # Random filename (never the original) — same convention as customer KYC
    # documents. Files are only ever served through the authenticated file
    # endpoint, scoped by loan id, never a public media URL.
    ext = os.path.splitext(filename)[1].lower()
    return f"loan_kyc_documents/loan_{instance.loan_id}/{uuid.uuid4().hex}{ext}"


class LoanKycDocument(models.Model):
    upload_token = models.UUIDField(null=True, blank=True, unique=True)
    """Documents attached to a specific Loan Application. Reuses the same document
    type choices and the shared CustomerDocumentType registry as customer-level KYC
    (Phase 8) rather than defining a parallel set — a custom "Other" name typed here
    is the same reusable catalog entry offered on the Add Customer screen."""
    DocumentType = CustomerKycDocument.DocumentType

    id = models.AutoField(primary_key=True, db_column="ID")
    loan = models.ForeignKey(CustomerLoanDetails, on_delete=models.CASCADE, related_name="kyc_documents", db_column="LoanID")
    document_type = models.CharField(max_length=20, choices=DocumentType.choices, db_column="DocumentType")
    other_document_name = models.CharField(max_length=100, blank=True, default="", db_column="OtherDocumentName")
    file = models.FileField(upload_to=loan_kyc_document_upload_path, storage=private_kyc_storage, db_column="File")
    original_file_name = models.CharField(max_length=255, db_column="OriginalFileName")
    file_type = models.CharField(max_length=100, db_column="FileType")
    file_size = models.PositiveIntegerField(default=0, db_column="FileSize")
    created_at = models.DateTimeField(auto_now_add=True, db_column="CreatedAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="UpdatedAt")

    class Meta:
        db_table = "LoanKYCDocument_tbl"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.loan.loan_no or self.loan_id} - {self.get_document_type_display()}"


def transaction_document_upload_path(instance, filename):
    ext = os.path.splitext(filename)[1].lower()
    owner = f"receipt_{instance.collection_id}" if instance.collection_id else f"payment_{instance.payment_id}"
    return f"transaction_documents/{owner}/{uuid.uuid4().hex}{ext}"


class TransactionDocument(models.Model):
    """Documents attached from the Today Report to one saved Receipt (CollectionTransaction)
    or one Payment Entry — exactly one of the two, enforced by a constraint, so a receipt's
    document can never surface on another receipt of the same customer or loan. Loan
    Application rows keep using LoanKycDocument. Attaching never touches the financial row."""
    DocumentType = CustomerKycDocument.DocumentType
    kyc_parent_fields = ("collection_id", "payment_id")

    id = models.AutoField(primary_key=True, db_column="ID")
    upload_token = models.UUIDField(null=True, blank=True, unique=True, db_column="UploadToken")
    collection = models.ForeignKey("CollectionTransaction", null=True, blank=True, on_delete=models.CASCADE, related_name="documents", db_column="CollectionTransactionID")
    payment = models.ForeignKey("PaymentEntry", null=True, blank=True, on_delete=models.CASCADE, related_name="documents", db_column="PaymentEntryID")
    document_type = models.CharField(max_length=20, choices=DocumentType.choices, db_column="DocumentType")
    other_document_name = models.CharField(max_length=100, blank=True, default="", db_column="OtherDocumentName")
    file = models.FileField(upload_to=transaction_document_upload_path, storage=private_kyc_storage, db_column="File")
    original_file_name = models.CharField(max_length=255, db_column="OriginalFileName")
    file_type = models.CharField(max_length=100, db_column="FileType")
    file_size = models.PositiveIntegerField(default=0, db_column="FileSize")
    created_at = models.DateTimeField(auto_now_add=True, db_column="CreatedAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="UpdatedAt")

    class Meta:
        db_table = "TransactionDocument_tbl"
        ordering = ["-created_at", "-id"]
        # Never both owners. "At least one" is enforced in save(), not here: on SQL Server
        # (no deferred constraints) Django's CASCADE first nulls a nullable FK, then deletes
        # the row, so an "exactly one" CHECK would block deleting the receipt or payment.
        constraints = [models.CheckConstraint(
            condition=models.Q(collection__isnull=True) | models.Q(payment__isnull=True),
            name="transaction_document_single_owner")]

    def save(self, *args, **kwargs):
        if not self.collection_id and not self.payment_id:
            raise ValueError("A transaction document must belong to a receipt or a payment entry.")
        return super().save(*args, **kwargs)

    def __str__(self):
        owner = f"RV-{self.collection_id:06d}" if self.collection_id else f"PV-{self.payment_id:06d}"
        return f"{owner} - {self.get_document_type_display()}"


class InterestDetails(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    loan = models.OneToOneField(CustomerLoanDetails, on_delete=models.CASCADE, related_name="interest_details", db_column="CustomerLoanDetailsID")
    principal_amount = models.DecimalField(**MONEY, db_column="PrincipalAmount")
    interest_percentage = models.DecimalField(max_digits=8, decimal_places=3, default=0, db_column="InterestPercentage")
    interest_amount = models.DecimalField(**MONEY, db_column="InterestAmount")
    total_payable_amount = models.DecimalField(**MONEY, db_column="TotalPayableAmount")
    loan_installment = models.ForeignKey(LoanInstallment, on_delete=models.PROTECT, db_column="LoanInstallmentID")
    duration_value = models.PositiveIntegerField(default=0, db_column="DurationValue")
    duration_type = models.CharField(max_length=5, blank=True, default="", db_column="DurationType")
    start_date = models.DateField(null=True, blank=True, db_column="StartDate")
    end_date = models.DateField(null=True, blank=True, db_column="EndDate")
    collection_day = models.PositiveSmallIntegerField(null=True, blank=True, db_column="CollectionDay")
    collection_date = models.DateField(null=True, blank=True, db_column="CollectionDate")
    collection_month = models.PositiveSmallIntegerField(null=True, blank=True, db_column="CollectionMonth")
    installment_count = models.PositiveIntegerField(default=0, db_column="InstallmentCount")
    installment_amount = models.DecimalField(**MONEY, db_column="InstallmentAmount")
    penalty_percentage = models.DecimalField(max_digits=8, decimal_places=3, default=0, db_column="PenaltyPercentage")
    penalty_type = models.CharField(max_length=30, blank=True, db_column="PenaltyType")
    grace_days = models.PositiveIntegerField(default=0, db_column="GraceDays")
    paid_amount = models.DecimalField(**MONEY, db_column="PaidAmount")
    outstanding_amount = models.DecimalField(**MONEY, db_column="OutstandingAmount")

    class Meta:
        db_table = "InterestDetails_tbl"


class CustomerChitDetails(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    loan = models.OneToOneField(CustomerLoanDetails, on_delete=models.CASCADE, related_name="chit_details", db_column="CustomerLoanDetailsID")
    chit_group = models.ForeignKey(ChitGroup, on_delete=models.PROTECT, db_column="ChitGroupID")
    include_sunday = models.BooleanField(default=False, db_column="IncludeSunday")

    class Meta:
        db_table = "CustomerChitDetails_tbl"


class MortgageLoanDetails(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    loan = models.OneToOneField(CustomerLoanDetails, on_delete=models.CASCADE, related_name="mortgage_details", db_column="CustomerLoanDetailsID")
    product = models.ForeignKey(Mortgage, on_delete=models.PROTECT, null=True, blank=True, db_column="MortgageID")
    product_name = models.CharField(max_length=150, blank=True, db_column="ProductName")
    unit = models.CharField(max_length=50, blank=True, db_column="Unit")
    quantity = models.DecimalField(max_digits=18, decimal_places=3, null=True, blank=True, db_column="Quantity")
    current_rate = models.DecimalField(**MONEY, db_column="CurrentRate")
    market_value = models.DecimalField(**MONEY, db_column="MarketValue")
    loan_amount = models.DecimalField(**MONEY, db_column="LoanAmount")
    interest_percentage = models.DecimalField(max_digits=8, decimal_places=3, default=0, db_column="InterestPercentage")
    daily_interest_amount = models.DecimalField(**MONEY, db_column="DailyInterestAmount")

    class Meta:
        db_table = "MortgageLoanDetails_tbl"


class CustomerLoanInstallmentDetails(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    loan = models.ForeignKey(CustomerLoanDetails, on_delete=models.CASCADE, related_name="installment_details", db_column="CustomerLoanDetailsID")
    installment_number = models.PositiveIntegerField(db_column="InstallmentNo")
    due_date = models.DateField(db_column="DueDate")
    installment_amount = models.DecimalField(**MONEY, db_column="InstallmentAmount")
    paid_amount = models.DecimalField(**MONEY, db_column="PaidAmount")
    penalty_amount = models.DecimalField(**MONEY, db_column="PenaltyAmount")
    outstanding_amount = models.DecimalField(**MONEY, db_column="OutstandingAmount")
    payment_status = models.CharField(max_length=20, default="PENDING", db_column="PaymentStatus")
    paid_date = models.DateField(null=True, blank=True, db_column="PaidDate")

    class Meta:
        db_table = "CustomerLoanInstallmentDetails_tbl"
        ordering = ("due_date", "installment_number")
        constraints = [models.UniqueConstraint(fields=("loan", "installment_number"), name="uniq_customer_loan_installment")]


class CollectionTransaction(AuditModel):
    id = models.AutoField(primary_key=True, db_column="CollectionTransactionID")
    installment = models.ForeignKey(CustomerLoanInstallmentDetails, on_delete=models.PROTECT, related_name="collection_transactions", db_column="InstallmentID")
    loan = models.ForeignKey(CustomerLoanDetails, on_delete=models.PROTECT, related_name="collection_transactions", db_column="CustomerLoanID")
    customer = models.ForeignKey("customers.Customer", on_delete=models.PROTECT, related_name="collection_transactions", db_column="CustomerID")
    collection_amount = models.DecimalField(**MONEY, db_column="CollectionAmount")
    advance_amount = models.DecimalField(**MONEY, db_column="AdvanceAmount")
    request_key = models.CharField(max_length=64, blank=True, default="", db_index=True, db_column="RequestKey")
    collection_date = models.DateField(db_column="CollectionDate")
    payment_mode = models.CharField(max_length=30, default="Cash", db_column="PaymentMode")
    reference_no = models.CharField(max_length=100, blank=True, default="", db_column="ReferenceNo")
    remarks = models.CharField(max_length=500, blank=True, default="", db_column="Remarks")
    upi_id = models.CharField(max_length=100, blank=True, default="", db_column="UpiID")
    bank_name = models.CharField(max_length=150, blank=True, default="", db_column="BankName")
    cheque_number = models.CharField(max_length=50, blank=True, default="", db_column="ChequeNumber")
    cheque_date = models.DateField(null=True, blank=True, db_column="ChequeDate")
    adjustment_type = models.CharField(max_length=100, blank=True, default="", db_column="AdjustmentType")
    adjustment_amount = models.DecimalField(**MONEY, db_column="AdjustmentAmount")
    discount_amount = models.DecimalField(**MONEY, db_column="DiscountAmount")
    account = models.ForeignKey("Ledger", on_delete=models.PROTECT, null=True, blank=True, related_name="collection_transactions", db_column="AccountLedgerID")
    ledger = models.ForeignKey("Ledger", on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_collections", db_column="LedgerID")
    party_ledger = models.ForeignKey("Ledger", on_delete=models.PROTECT, null=True, blank=True, related_name="party_collections", db_column="PartyLedgerID")
    LEDGER_GROUPS = [(name, name) for name in ("Sundry Debtors", "Sundry Creditors", "Indirect Expense", "Direct Expense", "Income")]
    ledger_group = models.CharField(max_length=30, blank=True, default="", choices=LEDGER_GROUPS, db_column="LedgerGroup")
    ledger_amount = models.DecimalField(**MONEY, db_column="LedgerAmount")
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")

    class Meta:
        db_table = "CollectionTransaction_tbl"
        ordering = ("-collection_date", "-id")


class CollectionAllocation(models.Model):
    """How one collection was split across installments (used for receipts)."""
    transaction = models.ForeignKey(CollectionTransaction, on_delete=models.CASCADE, related_name="allocations", db_column="CollectionTransactionID")
    installment = models.ForeignKey(CustomerLoanInstallmentDetails, on_delete=models.PROTECT, related_name="collection_allocations", db_column="InstallmentID")
    amount = models.DecimalField(**MONEY, db_column="Amount")

    class Meta:
        db_table = "CollectionAllocation_tbl"
        ordering = ("id",)


class AdjustmentTypeMaster(AuditModel):
    id = models.AutoField(primary_key=True, db_column="AdjustmentTypeID")
    name = models.CharField(max_length=100, unique=True, db_column="AdjustmentTypeName")
    is_active = models.BooleanField(default=True, db_column="IsActive")

    class Meta:
        db_table = "AdjustmentTypeMaster_tbl"
        ordering = ("name",)


class HolidayMaster(AuditModel):
    # Holiday Calendar types. GOVERNMENT / LOCAL / WEEKLY_OFF / SPECIAL_LEAVE are Off days;
    # SUNDAY_WORKING marks a Sunday ticked as a Working Day (unticked Sundays are Off).
    # STATE / OPTIONAL / CUSTOM are earlier types kept for existing records.
    GOVERNMENT, LOCAL, WEEKLY_OFF, SPECIAL_LEAVE, SUNDAY_WORKING = "GOVERNMENT", "LOCAL", "WEEKLY_OFF", "SPECIAL_LEAVE", "SUNDAY_WORKING"
    TYPES = (GOVERNMENT, LOCAL, WEEKLY_OFF, SPECIAL_LEAVE, SUNDAY_WORKING, "STATE", "OPTIONAL", "CUSTOM")
    id = models.AutoField(primary_key=True, db_column="ID")
    holiday_date = models.DateField(unique=True, db_column="HolidayDate")
    holiday_name = models.CharField(max_length=150, db_column="HolidayName")
    holiday_type = models.CharField(max_length=30, db_column="HolidayType")
    state_region = models.CharField(max_length=150, blank=True, default="")
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True, db_column="IsActive")
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")

    class Meta:
        db_table = "HolidayMaster_tbl"


class LoanHolidaySettings(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    loan = models.ForeignKey(CustomerLoanDetails, on_delete=models.CASCADE, related_name="holiday_settings", db_column="CustomerLoanDetailsID")
    holiday = models.ForeignKey(HolidayMaster, on_delete=models.PROTECT, db_column="HolidayID")
    include_in_schedule = models.BooleanField(default=False, db_column="IncludeInSchedule")

    class Meta:
        db_table = "LoanHolidaySettings_tbl"
        constraints = [models.UniqueConstraint(fields=("loan", "holiday"), name="uniq_loan_holiday_setting")]


class MortgageRate(models.Model):
    mortgage = models.ForeignKey(Mortgage, on_delete=models.CASCADE, related_name="rates")
    date = models.DateField()
    rate = models.DecimalField(**MONEY)

    class Meta:
        ordering = ("-date", "-id")
        constraints = [models.UniqueConstraint(fields=("mortgage", "date"), name="uniq_mortgage_rate_date")]


class MortgageUnit(models.Model):
    name = models.CharField(max_length=50, unique=True)

    class Meta:
        ordering = ("name",)


class MortgageProductGroup(models.Model):
    name = models.CharField(max_length=50, unique=True)

    class Meta:
        ordering = ("name",)


class MortgageUqc(models.Model):
    name = models.CharField(max_length=20, unique=True)

    class Meta:
        db_table = "MortgageUQC_tbl"
        ordering = ("name",)

    def save(self, *args, **kwargs):
        self.name = (self.name or "").strip().upper()
        super().save(*args, **kwargs)


class LoanDocumentSequence(models.Model):
    prefix = models.CharField(max_length=20, primary_key=True)
    last_value = models.PositiveIntegerField(default=0)


class MortgageLoanHistory(models.Model):
    loan = models.ForeignKey(CustomerLoanDetails, null=True, on_delete=models.SET_NULL, related_name="mortgage_history")
    doc_no = models.CharField(max_length=30)
    customer_name = models.CharField(max_length=150)
    action = models.CharField(max_length=10, choices=[('CREATED', 'Created'), ('UPDATED', 'Updated'), ('EXISTING', 'Existing')])
    recorded_at = models.DateTimeField(default=timezone.now)
    recorded_by = models.CharField(max_length=150, blank=True)
    snapshot = models.JSONField()

    class Meta:
        ordering = ('-recorded_at', '-id')


class Ledger(AuditModel):
    GROUPS = [(name, name) for name in ('Sundry Debtors', 'Sundry Creditors', 'Indirect Expense',
                                      'Direct Expense', 'Income', 'Cash-in-Hand', 'Bank Accounts')]
    customer = models.ForeignKey('customers.Customer', null=True, blank=True, on_delete=models.SET_NULL, related_name='ledgers')
    name = models.CharField(max_length=150)
    # Legacy root-level classification, kept for existing report/signal code
    # that filters ledgers by this string; auto-synced from group_detail.
    group = models.CharField(max_length=30, choices=GROUPS)
    # Precise Group_tbl node the ledger is tagged to (any depth); `group`
    # above is derived from this node's root ancestor, never set directly
    # by the UI anymore.
    group_detail = models.ForeignKey("Group", null=True, blank=True, on_delete=models.SET_NULL, related_name="ledgers_detail", db_column="GroupDetailID")
    opening_balance = models.DecimalField(**MONEY)
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")
    # Bank details -- only used (and required by the API) when the ledger's group
    # resolves to the "Bank Accounts" root; blank for every other ledger.
    bank_name = models.CharField(max_length=150, blank=True, default="")
    branch_name = models.CharField(max_length=150, blank=True, default="")
    ifsc_code = models.CharField(max_length=11, blank=True, default="")
    account_number = models.CharField(max_length=18, blank=True, default="")
    # Optional tax details (same shape as Group Master).
    hsn_code = models.CharField(max_length=30, blank=True, default="", db_column="HSNCode")
    rate_of_tax = models.PositiveSmallIntegerField(default=0, choices=[(value, f"{value}%") for value in (0, 5, 12, 18, 28)], db_column="RateOfTax")
    # Party Collection preference (Sundry Debtors only). Blank = not a Party Collection
    # party; existing ledgers are never given one automatically.
    DUE_WISE, CONSOLIDATED = 'DUE_WISE', 'CONSOLIDATED'
    COLLECTION_TYPES = [(DUE_WISE, 'Due-wise Collection'), (CONSOLIDATED, 'Consolidated Collection')]
    collection_type = models.CharField(max_length=12, choices=COLLECTION_TYPES, blank=True, default='', db_column='CollectionType')

    BANK_GROUP = 'Bank Accounts'
    DEBTORS_GROUP = 'Sundry Debtors'
    CASH_GROUP = 'Cash-in-Hand'
    # Ledgers that carry HSN Code / Rate of Tax: Income/Expense roots (by Group
    # nature), or the legacy flat group names for ledgers without group_detail.
    TAXABLE_NATURES = ('INCOME', 'EXPENSE')
    TAXABLE_GROUPS = ('Income', 'Direct Expense', 'Indirect Expense')
    BANK_FIELDS = ('bank_name', 'branch_name', 'ifsc_code', 'account_number')

    class Meta:
        ordering = ('name', 'id')
        # One linked Party Ledger per Customer; ledgers without a customer are unrestricted.
        constraints = [models.UniqueConstraint(fields=('customer',), condition=models.Q(customer__isnull=False), name='uniq_ledger_per_customer')]


class Group(AuditModel):
    """Self-referencing chart-of-accounts group tree (unlimited depth).
    Root groups are seeded as system records; every other group must chain
    up to one of them via parent_id, never by storing the parent's name."""
    # Accounting classification (Asset/Liability/Income/Expense) is only
    # ever set on root (is_system) groups -- every descendant inherits its
    # root's nature, since e.g. any sub-group under "Fixed Assets" is still
    # an asset. Reports resolve a ledger's nature via root().nature, never
    # by matching a group/ledger name.
    NATURE_CHOICES = [("ASSET", "Asset"), ("LIABILITY", "Liability"), ("INCOME", "Income"), ("EXPENSE", "Expense")]
    id = models.AutoField(primary_key=True, db_column="ID")
    name = models.CharField(max_length=150, db_column="GroupName")
    parent = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True, related_name="children", db_column="ParentGroupID")
    is_system = models.BooleanField(default=False, db_column="IsSystem")
    is_active = models.BooleanField(default=True, db_column="IsActive")
    nature = models.CharField(max_length=10, choices=NATURE_CHOICES, blank=True, default="", db_column="Nature")
    # Optional tax details (same shape as the Product master) for future module integration.
    hsn_code = models.CharField(max_length=30, blank=True, default="", db_column="HSNCode")
    rate_of_tax = models.PositiveSmallIntegerField(default=0, choices=[(value, f"{value}%") for value in (0, 5, 12, 18, 28)], db_column="RateOfTax")
    unit = models.CharField(max_length=50, blank=True, default="", db_column="Unit")
    uqc = models.CharField(max_length=20, blank=True, default="", db_column="UQC")
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")

    class Meta:
        db_table = "Group_tbl"
        ordering = ("name", "id")
        constraints = [models.UniqueConstraint(fields=("parent", "name"), name="uniq_group_parent_name")]

    def root(self):
        """Walk up to the top-most ancestor (the is_system root)."""
        node = self
        seen = {node.id}
        while node.parent_id is not None and node.parent_id not in seen:
            node = node.parent
            seen.add(node.id)
        return node


class PaymentEntry(AuditModel):
    PAYMENT_MODES = [('Cash', 'Cash'), ('UPI', 'UPI'), ('Cheque', 'Cheque'), ('NEFT', 'NEFT'), ('RTGS', 'RTGS'), ('IMPS', 'IMPS')]
    LEDGER_GROUPS = [(name, name) for name in ('Sundry Debtors', 'Sundry Creditors', 'Indirect Expense', 'Direct Expense', 'Income')]
    ACCOUNT_GROUPS = ('Cash-in-Hand', 'Bank Accounts')
    # ledger/accounts are kept for earlier entries; new entries use ledger_group and account.
    ledger = models.ForeignKey(Ledger, on_delete=models.PROTECT, related_name='payments', null=True, blank=True)
    accounts = models.CharField(max_length=10, choices=[('Card', 'Card'), ('Credit', 'Credit')], blank=True, default='')
    ledger_group = models.CharField(max_length=30, choices=LEDGER_GROUPS, blank=True, default='')
    account = models.ForeignKey(Ledger, on_delete=models.PROTECT, related_name='account_payments', null=True, blank=True)
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    payment_mode = models.CharField(max_length=10, choices=PAYMENT_MODES)
    date = models.DateField(default=timezone.localdate)
    upi_id = models.CharField(max_length=100, blank=True)
    transaction_utr = models.CharField(max_length=100, blank=True)
    bank_name = models.CharField(max_length=150, blank=True)
    cheque_number = models.CharField(max_length=50, blank=True)
    cheque_date = models.DateField(null=True, blank=True)
    notes = models.CharField(max_length=500, blank=True, default='')
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")
    # Optional tag only: a Payment Entry never touches the loan's installments; null = direct party-ledger payment.
    loan = models.ForeignKey('CustomerLoanDetails', null=True, blank=True, on_delete=models.SET_NULL, related_name='payment_entries')

    class Meta:
        ordering = ('-date', '-id')


class BankTransfer(AuditModel):
    # Internal money movement between Cash-in-Hand / Bank Accounts ledgers:
    # FROM is credited (money out), TO is debited (money in), same amount.
    TYPES = [('DEPOSIT', 'Cash Deposit'), ('WITHDRAWAL', 'Cash Withdrawal'), ('TRANSFER', 'Bank Transfer')]
    # (From group, To group) per transaction type.
    DIRECTIONS = {'DEPOSIT': ('Cash-in-Hand', 'Bank Accounts'), 'WITHDRAWAL': ('Bank Accounts', 'Cash-in-Hand'),
                  'TRANSFER': ('Bank Accounts', 'Bank Accounts')}
    # Payment Mode describes how the money moved; it never creates a posting of its own.
    MODES = {'DEPOSIT': ('Cash',), 'WITHDRAWAL': ('Cash', 'Cheque'), 'TRANSFER': ('NEFT', 'UPI', 'Cheque')}
    transaction_type = models.CharField(max_length=10, choices=TYPES)
    # Blank only on transfers saved before Payment Mode existed.
    payment_mode = models.CharField(max_length=10, choices=PaymentEntry.PAYMENT_MODES, blank=True, default='')
    date = models.DateField(default=timezone.localdate)
    from_account = models.ForeignKey(Ledger, on_delete=models.PROTECT, related_name='bank_transfers_out')
    to_account = models.ForeignKey(Ledger, on_delete=models.PROTECT, related_name='bank_transfers_in')
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    reference_no = models.CharField(max_length=100, blank=True, default='')
    notes = models.CharField(max_length=500, blank=True, default='')

    # Voucher No is the row's database identity: the database assigns it atomically on
    # insert (safe under concurrent saves), never reuses a deleted value, and an edit can
    # never change it.
    @staticmethod
    def format_voucher(number):
        return f'BT-{number:06d}'

    @property
    def voucher_no(self):
        return self.format_voucher(self.pk) if self.pk else ''

    @classmethod
    def next_voucher_no(cls):
        """Preview of the number the next save will receive (the save itself assigns it)."""
        from django.db import connections
        connection = connections[cls.objects.db]
        table = cls._meta.db_table
        with connection.cursor() as cursor:
            if connection.vendor == 'microsoft':
                # last_value is NULL until the table has ever issued an identity value.
                cursor.execute("SELECT CAST(seed_value AS bigint), CAST(increment_value AS bigint), CAST(last_value AS bigint) "
                               "FROM sys.identity_columns WHERE object_id = OBJECT_ID(%s)", [table])
                row = cursor.fetchone()
                if row:
                    seed, step, last = row
                    return cls.format_voucher(seed if last is None else last + step)
            elif connection.vendor == 'sqlite':
                cursor.execute("SELECT seq FROM sqlite_sequence WHERE name = %s", [table])
                row = cursor.fetchone()
                return cls.format_voucher((row[0] if row else 0) + 1)
        last = cls.objects.order_by('-pk').values_list('pk', flat=True).first()
        return cls.format_voucher((last or 0) + 1)

    class Meta:
        ordering = ('-date', '-id')
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name='bank_transfer_positive_amount'),
                       models.CheckConstraint(condition=~models.Q(from_account=models.F('to_account')), name='bank_transfer_distinct_accounts')]


class PartyDue(AuditModel):
    """A receivable raised directly against a Party (Sundry Debtors) ledger from
    Party Collection. Posts Dr Party / Cr the chosen counter ledger; independent
    of loan installment dues."""
    party = models.ForeignKey(Ledger, on_delete=models.PROTECT, related_name='party_dues', db_column='PartyLedgerID')
    counter_ledger = models.ForeignKey(Ledger, on_delete=models.PROTECT, related_name='party_due_credits', db_column='CounterLedgerID')
    due_date = models.DateField(db_column='DueDate')
    due_number = models.CharField(max_length=50, db_column='DueNumber')
    amount = models.DecimalField(max_digits=18, decimal_places=2, db_column='DueAmount')
    notes = models.CharField(max_length=500, blank=True, default='', db_column='Notes')
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")

    @property
    def voucher_no(self):
        return f'DUE-{self.pk:06d}' if self.pk else ''

    class Meta:
        db_table = 'PartyDue_tbl'
        ordering = ('due_date', 'id')
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name='party_due_positive_amount'),
                       models.UniqueConstraint(fields=('party', 'due_number'), name='uniq_party_due_number')]


class PartyCollection(AuditModel):
    """One Party Collection receipt voucher: Dr Cash/Bank account, Cr Party ledger.
    The part not allocated to dues is the party's unallocated advance."""
    party = models.ForeignKey(Ledger, on_delete=models.PROTECT, related_name='party_receipts', db_column='PartyLedgerID')
    account = models.ForeignKey(Ledger, on_delete=models.PROTECT, related_name='party_receipt_accounts', db_column='AccountLedgerID')
    date = models.DateField(db_column='CollectionDate')
    amount = models.DecimalField(max_digits=18, decimal_places=2, db_column='CollectionAmount')
    payment_mode = models.CharField(max_length=10, choices=PaymentEntry.PAYMENT_MODES, db_column='PaymentMode')
    upi_id = models.CharField(max_length=100, blank=True, default='', db_column='UpiID')
    transaction_utr = models.CharField(max_length=100, blank=True, default='', db_column='TransactionUTR')
    bank_name = models.CharField(max_length=150, blank=True, default='', db_column='BankName')
    cheque_number = models.CharField(max_length=50, blank=True, default='', db_column='ChequeNumber')
    cheque_date = models.DateField(null=True, blank=True, db_column='ChequeDate')
    notes = models.CharField(max_length=500, blank=True, default='', db_column='Notes')
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")

    @property
    def voucher_no(self):
        return f'PC-{self.pk:06d}' if self.pk else ''

    class Meta:
        db_table = 'PartyCollection_tbl'
        ordering = ('-date', '-id')
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name='party_collection_positive_amount')]


class PartyAllocation(models.Model):
    """Applies part of a receipt to one due. No accounting posting of its own: the
    money was already posted by its PartyCollection, so applying an advance later
    never touches Cash/Bank again."""
    collection = models.ForeignKey(PartyCollection, on_delete=models.CASCADE, related_name='allocations', db_column='PartyCollectionID')
    due = models.ForeignKey(PartyDue, on_delete=models.PROTECT, related_name='allocations', db_column='PartyDueID')
    amount = models.DecimalField(max_digits=18, decimal_places=2, db_column='AllocatedAmount')
    date = models.DateField(db_column='AllocationDate')
    from_advance = models.BooleanField(default=False, db_column='FromAdvance')
    created_at = models.DateTimeField(auto_now_add=True, db_column='CreatedAt')

    class Meta:
        db_table = 'PartyAllocation_tbl'
        ordering = ('date', 'id')
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name='party_allocation_positive_amount')]


def next_identity_number(model):
    """Preview of the identity value the next insert into `model` will receive (the save
    itself assigns it atomically, so this is only a preview -- same approach as Bank
    Transaction voucher numbers)."""
    from django.db import connections
    connection = connections[model.objects.db]
    table = model._meta.db_table
    with connection.cursor() as cursor:
        if connection.vendor == 'microsoft':
            cursor.execute("SELECT CAST(seed_value AS bigint), CAST(increment_value AS bigint), CAST(last_value AS bigint) "
                           "FROM sys.identity_columns WHERE object_id = OBJECT_ID(%s)", [table])
            row = cursor.fetchone()
            if row:
                seed, step, last = row
                return seed if last is None else last + step
        elif connection.vendor == 'sqlite':
            cursor.execute("SELECT seq FROM sqlite_sequence WHERE name = %s", [table])
            row = cursor.fetchone()
            return (row[0] if row else 0) + 1
    last = model.objects.order_by('-pk').values_list('pk', flat=True).first()
    return (last or 0) + 1


class JournalVoucher(AuditModel):
    """Journal Entry voucher (JV-xxxxxx). Its lines are the postings: Dr lines add to a
    ledger's balance, Cr lines reduce it; the voucher always balances."""
    date = models.DateField(default=timezone.localdate, db_column='VoucherDate')
    narration = models.CharField(max_length=1000, blank=True, default='', db_column='Narration')
    # Sent by the form and kept for the voucher's life: a retried / double-clicked Save
    # with the same token returns the voucher already saved instead of posting it twice.
    client_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False, db_column='ClientToken')

    @staticmethod
    def format_voucher(number):
        return f'JV-{number:06d}'

    @property
    def voucher_no(self):
        return self.format_voucher(self.pk) if self.pk else ''

    @classmethod
    def next_voucher_no(cls):
        return cls.format_voucher(next_identity_number(cls))

    class Meta:
        db_table = 'JournalVoucher_tbl'
        ordering = ('-date', '-id')


class JournalLine(models.Model):
    DEBIT, CREDIT = 'DR', 'CR'
    voucher = models.ForeignKey(JournalVoucher, on_delete=models.CASCADE, related_name='lines', db_column='JournalVoucherID')
    # Grid row the line was entered on (each row holds one Cr and/or one Dr ledger).
    row = models.PositiveSmallIntegerField(db_column='RowNo')
    side = models.CharField(max_length=2, choices=[(DEBIT, 'Debit'), (CREDIT, 'Credit')], db_column='Side')
    ledger = models.ForeignKey(Ledger, on_delete=models.PROTECT, related_name='journal_lines', db_column='LedgerID')
    amount = models.DecimalField(max_digits=18, decimal_places=2, db_column='Amount')

    class Meta:
        db_table = 'JournalLine_tbl'
        ordering = ('row', 'side', 'id')
        constraints = [models.CheckConstraint(condition=models.Q(amount__gt=0), name='journal_line_positive_amount'),
                       models.UniqueConstraint(fields=('voucher', 'row', 'side'), name='uniq_journal_line_row_side')]


class JournalAudit(models.Model):
    """Audit trail of journal changes; kept after the voucher itself is deleted."""
    voucher_id = models.IntegerField(db_column='JournalVoucherID', db_index=True)
    voucher_no = models.CharField(max_length=20, db_column='VoucherNo')
    action = models.CharField(max_length=10, choices=[('CREATE', 'Created'), ('UPDATE', 'Edited'), ('DELETE', 'Deleted')], db_column='Action')
    before = models.JSONField(null=True, blank=True, db_column='BeforeData')
    after = models.JSONField(null=True, blank=True, db_column='AfterData')
    changed_by = models.CharField(max_length=100, blank=True, default='', db_column='ChangedBy')
    changed_at = models.DateTimeField(auto_now_add=True, db_column='ChangedAt')

    class Meta:
        db_table = 'JournalAudit_tbl'
        ordering = ('-changed_at', '-id')
