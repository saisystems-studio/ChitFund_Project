from decimal import Decimal
from django.db import models
from django.db import transaction
from django.utils import timezone


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
    product_name = models.CharField(max_length=150, unique=True, db_column="ProductName")
    quantity = models.DecimalField(max_digits=18, decimal_places=3, null=True, blank=True, db_column="Quantity")
    unit = models.CharField(max_length=50, db_column="Unit")
    current_rate = models.DecimalField(**MONEY, db_column="CurrentRate")
    is_active = models.BooleanField(default=True, db_column="IsActive")

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

    class Meta:
        db_table = "CollectionTransaction_tbl"
        ordering = ("-collection_date", "-id")


class AdjustmentTypeMaster(AuditModel):
    id = models.AutoField(primary_key=True, db_column="AdjustmentTypeID")
    name = models.CharField(max_length=100, unique=True, db_column="AdjustmentTypeName")
    is_active = models.BooleanField(default=True, db_column="IsActive")

    class Meta:
        db_table = "AdjustmentTypeMaster_tbl"
        ordering = ("name",)


class HolidayMaster(AuditModel):
    id = models.AutoField(primary_key=True, db_column="ID")
    holiday_date = models.DateField(unique=True, db_column="HolidayDate")
    holiday_name = models.CharField(max_length=150, db_column="HolidayName")
    holiday_type = models.CharField(max_length=30, db_column="HolidayType")
    state_region = models.CharField(max_length=150, blank=True, default="")
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True, db_column="IsActive")

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
                                      'Direct Expense', 'Income', 'Cash in Hand', 'Bank Accounts')]
    name = models.CharField(max_length=150)
    group = models.CharField(max_length=30, choices=GROUPS)
    opening_balance = models.DecimalField(**MONEY)

    class Meta:
        ordering = ('name', 'id')


class PaymentEntry(AuditModel):
    PAYMENT_MODES = [('Cash', 'Cash'), ('UPI', 'UPI'), ('Cheque', 'Cheque'), ('NEFT', 'NEFT/IMPS/RGST')]
    ledger = models.ForeignKey(Ledger, on_delete=models.PROTECT, related_name='payments')
    accounts = models.CharField(max_length=10, choices=[('Card', 'Card'), ('Credit', 'Credit')])
    amount = models.DecimalField(max_digits=18, decimal_places=2)
    payment_mode = models.CharField(max_length=10, choices=PAYMENT_MODES)
    date = models.DateField(default=timezone.localdate)
    upi_id = models.CharField(max_length=100, blank=True)
    transaction_utr = models.CharField(max_length=100, blank=True)
    bank_name = models.CharField(max_length=150, blank=True)
    cheque_number = models.CharField(max_length=50, blank=True)
    cheque_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ('-date', '-id')
