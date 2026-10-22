import os
import uuid

from django.db import models

from customers.kyc_security import private_kyc_storage
from customers.models import CustomerKycDocument


class Staff(models.Model):
    class Gender(models.TextChoices):
        MALE = "Male", "Male"
        FEMALE = "Female", "Female"
        OTHER = "Other", "Other"

    id = models.AutoField(primary_key=True)
    staff_id = models.CharField(max_length=20, unique=True, editable=False, db_index=True)
    staff_name = models.CharField(max_length=150, db_index=True)
    phone_number = models.CharField(max_length=15, db_index=True)
    alternative_phone_number = models.CharField(max_length=15, blank=True)
    aadhaar_number = models.CharField(max_length=12, blank=True, db_index=True)
    address = models.TextField(blank=True)
    gender = models.CharField(max_length=10, choices=Gender.choices, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    anniversary_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "staff_tbl"
        ordering = ["staff_name"]
        verbose_name_plural = "staff"

    def __str__(self):
        return f"{self.staff_name} - {self.staff_id}"


def staff_kyc_document_upload_path(instance, filename):
    # Random filename (never the original), same convention as customer and loan KYC
    # documents; files are only served through the authenticated, staff-scoped endpoint.
    ext = os.path.splitext(filename)[1].lower()
    return f"staff_kyc_documents/staff_{instance.staff_id}/{uuid.uuid4().hex}{ext}"


class StaffKycDocument(models.Model):
    """ID / KYC documents attached to a Staff record. Same document types, private
    storage, validation and retry-safe upload_token as customer and loan documents."""
    DocumentType = CustomerKycDocument.DocumentType
    # Owner field checked by create_kyc_document when an upload_token is retried.
    kyc_parent_fields = ("staff_id",)

    id = models.AutoField(primary_key=True, db_column="ID")
    upload_token = models.UUIDField(null=True, blank=True, unique=True)
    staff = models.ForeignKey(Staff, on_delete=models.CASCADE, related_name="kyc_documents", db_column="StaffID")
    document_type = models.CharField(max_length=20, choices=DocumentType.choices, db_column="DocumentType")
    other_document_name = models.CharField(max_length=100, blank=True, default="", db_column="OtherDocumentName")
    file = models.FileField(upload_to=staff_kyc_document_upload_path, storage=private_kyc_storage, db_column="File")
    original_file_name = models.CharField(max_length=255, db_column="OriginalFileName")
    file_type = models.CharField(max_length=100, db_column="FileType")
    file_size = models.PositiveIntegerField(default=0, db_column="FileSize")
    created_at = models.DateTimeField(auto_now_add=True, db_column="CreatedAt")
    updated_at = models.DateTimeField(auto_now=True, db_column="UpdatedAt")

    class Meta:
        db_table = "StaffKYCDocument_tbl"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.staff.staff_id} - {self.get_document_type_display()}"
