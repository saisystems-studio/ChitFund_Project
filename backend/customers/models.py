import os
import uuid

from django.db import models
from .kyc_security import private_kyc_storage


class CountryMaster(models.Model):
    name = models.CharField(max_length=120, unique=True, db_index=True)

    class Meta:
        db_table = "CountryMaster"
        ordering = ["name"]

    def __str__(self):
        return self.name


class StateMaster(models.Model):
    name = models.CharField(max_length=120, db_index=True)
    country = models.ForeignKey(CountryMaster, on_delete=models.PROTECT, related_name="states")

    class Meta:
        db_table = "StateMaster"
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["name", "country"], name="uniq_state_country")]

    def __str__(self):
        return self.name


class DistrictMaster(models.Model):
    name = models.CharField(max_length=120, db_index=True)
    state = models.ForeignKey(StateMaster, on_delete=models.PROTECT, related_name="districts")
    pincode = models.CharField(max_length=10, blank=True, null=True)

    class Meta:
        db_table = "DistrictMaster"
        ordering = ["name"]
        constraints = [models.UniqueConstraint(fields=["name", "state"], name="uniq_district_state")]

    def __str__(self):
        return self.name

class Customer(models.Model):
    class Role(models.TextChoices):
        LENDER = "LENDER", "Lender"
        BORROWER = "BORROWER", "Borrower"
        BOTH = "BOTH", "Both"

    id = models.AutoField(primary_key=True, db_column="ID")
    customer_code = models.CharField(max_length=20, unique=True, editable=False, db_index=True, db_column="CustomerCode")
    full_name = models.CharField(max_length=150, db_index=True, db_column="CustomerName")
    dob = models.DateField(null=True, blank=True, db_column="DOB")
    gender = models.CharField(max_length=20, blank=True, db_column="Gender")
    occupation = models.CharField(max_length=120, blank=True, db_column="Occupation")
    monthly_income = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True, db_column="MonthlyIncome")
    primary_mobile = models.CharField(max_length=15, unique=True, db_index=True, db_column="Phone")
    alternate_mobile = models.CharField(max_length=15, blank=True, db_column="AlternatePhone")
    whatsapp_number = models.CharField(max_length=15, blank=True, db_column="WhatsApp")
    is_whatsapp_same_as_phone = models.BooleanField(default=False, db_column="IsWhatsappSameAsPhone")
    email = models.EmailField(blank=True, db_column="Email")
    role = models.CharField(max_length=10, choices=Role.choices, db_index=True, db_column="CustomerRole")
    # Additive, nullable link into the Group_tbl hierarchy (Sundry Debtors/
    # Sundry Creditors and their descendants). Existing rows stay NULL; role
    # remains the source of truth for Debtor/Creditor/Both classification.
    group = models.ForeignKey("finance.Group", null=True, blank=True, on_delete=models.SET_NULL, related_name="customers", db_column="GroupID")
    done_by_staff = models.ForeignKey("staff.Staff", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", db_column="DoneByStaffID")
    address = models.TextField(blank=True, db_column="Address")
    city = models.CharField(max_length=80, blank=True, db_column="City")
    district = models.CharField(max_length=80, blank=True, db_column="District")
    state = models.CharField(max_length=80, blank=True, db_column="State")
    country = models.CharField(max_length=80, default="India", blank=True, db_column="Country")
    pincode = models.CharField(max_length=10, blank=True, db_column="Pincode")
    aadhaar_number = models.CharField(max_length=12, blank=True, db_index=True, db_column="Aadhaar")
    pan_number = models.CharField(max_length=10, blank=True, db_index=True, db_column="PAN")
    is_active = models.BooleanField(default=True, db_index=True, db_column="IsActive")
    created_by = models.CharField(max_length=100, null=True, blank=True, db_column="CreatedBy")
    created_at = models.DateTimeField(auto_now_add=True, db_column="CreateDate")
    modified_by = models.CharField(max_length=100, null=True, blank=True, db_column="ModifiedBy")
    updated_at = models.DateTimeField(auto_now=True, db_column="ModifiedDate")

    class Meta:
        db_table = "Customer_tbl"
        ordering = ["full_name"]

    def __str__(self):
        return f"{self.customer_code} - {self.full_name}"


def kyc_document_upload_path(instance, filename):
    # Random filename (never the original) so a guessed/shared path leaks nothing —
    # documents are only ever served through the authenticated file endpoint anyway.
    ext = os.path.splitext(filename)[1].lower()
    return f"kyc_documents/customer_{instance.customer_id}/{uuid.uuid4().hex}{ext}"


class CustomerDocumentType(models.Model):
    """Reusable custom "Other" document-type names, offered back in the ID Proof
    dropdown once a customer has used them. Built-in types (Aadhaar, PAN, ...) are
    not stored here — only names a user actually typed under "Other"."""
    name = models.CharField(max_length=100, unique=True, db_column="Name")
    created_at = models.DateTimeField(auto_now_add=True, db_column="CreatedAt")

    class Meta:
        db_table = "CustomerDocumentType_tbl"
        ordering = ["name"]

    def __str__(self):
        return self.name


class CustomerKycDocument(models.Model):
    upload_token = models.UUIDField(null=True, blank=True, unique=True)
    class DocumentType(models.TextChoices):
        AADHAAR = "AADHAAR", "Aadhaar Card"
        PAN = "PAN", "PAN Card"
        RATION = "RATION", "Ration Card"
        VOTER_ID = "VOTER_ID", "Voter ID"
        DRIVING_LICENCE = "DRIVING_LICENCE", "Driving Licence"
        PASSPORT = "PASSPORT", "Passport"
        BANK_PASSBOOK = "BANK_PASSBOOK", "Bank Passbook"
        OTHER = "OTHER", "Other"

    id = models.AutoField(primary_key=True, db_column="ID")
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="kyc_documents", db_column="CustomerID")
    document_type = models.CharField(max_length=20, choices=DocumentType.choices, db_column="DocumentType")
    other_document_name = models.CharField(max_length=100, blank=True, default="", db_column="OtherDocumentName")
    file = models.FileField(upload_to=kyc_document_upload_path, storage=private_kyc_storage, db_column="File")
    original_file_name = models.CharField(max_length=255, db_column="OriginalFileName")
    file_type = models.CharField(max_length=100, db_column="FileType")
    file_size = models.PositiveIntegerField(default=0, db_column="FileSize")
    created_at = models.DateTimeField(auto_now_add=True, db_column="CreatedAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="UpdatedAt")

    class Meta:
        db_table = "CustomerKYCDocument_tbl"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.customer.customer_code} - {self.get_document_type_display()}"
