import re
from datetime import date
from rest_framework import serializers
from staff.serializers import DoneBySerializerMixin
from .models import Customer, CustomerDocumentType, CustomerKycDocument
from .kyc_security import validate_kyc_file, create_kyc_document

KYC_MAX_FILE_SIZE = 5 * 1024 * 1024
KYC_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
KYC_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}

# Customer Type is no longer a field the user picks; role is derived from
# whichever root (Sundry Debtors/Sundry Creditors) the chosen Group descends
# from, so the Ledger auto-sync signal and existing role-based reports keep
# working unchanged.
ROLE_BY_ROOT_NAME = {"Sundry Debtors": "BORROWER", "Sundry Creditors": "LENDER"}


class CustomerSerializer(DoneBySerializerMixin, serializers.ModelSerializer):
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    # Display-only; the stored relationship is always customer.group_id (Group_tbl.id), never this name.
    group_name = serializers.SerializerMethodField()
    # The customer's linked Party Ledger (Customer ID <-> Ledger ID).
    ledger_id = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = "__all__"
        read_only_fields = ("id", "customer_code", "created_at", "updated_at", "role", "role_display", "group_name", "ledger_id")

    def get_group_name(self, obj):
        return obj.group.name if obj.group_id else None

    def get_ledger_id(self, obj):
        # Reads the prefetched `ledgers` relation when the view supplied it (no query per row).
        ids = sorted(ledger.pk for ledger in obj.ledgers.all() if ledger.group not in ("Cash-in-Hand", "Bank Accounts"))
        return ids[0] if ids else None

    def to_internal_value(self, data):
        if data.get("dob") == "":
            data = data.copy()
            data["dob"] = None
        return super().to_internal_value(data)

    def validate_primary_mobile(self, value):
        if not value.isdigit() or len(value) != 10:
            raise serializers.ValidationError("Phone number must contain exactly 10 digits.")
        return value

    def validate_full_name(self, value):
        value = " ".join(value.strip().split())
        if len(value) < 2 or not re.fullmatch(r"[A-Za-z .'-]+", value):
            raise serializers.ValidationError("Enter a valid name with at least 2 letters.")
        return value

    def validate_dob(self, value):
        if value and value > date.today():
            raise serializers.ValidationError("Date of birth cannot be in the future.")
        return value

    def validate_monthly_income(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("Monthly income cannot be negative.")
        return value

    def validate_aadhaar_number(self, value):
        if not value:
            return value
        if not value.isdigit() or len(value) != 12: raise serializers.ValidationError("Aadhaar number must contain exactly 12 digits.")
        return value

    def validate_alternate_mobile(self, value):
        if value and (not value.isdigit() or len(value) != 10):
            raise serializers.ValidationError("Alternate phone must contain exactly 10 digits.")
        return value

    def validate_whatsapp_number(self, value):
        if value and (not value.isdigit() or len(value) != 10):
            raise serializers.ValidationError("WhatsApp number must contain exactly 10 digits.")
        return value

    def validate_pincode(self, value):
        if value and (not value.isdigit() or len(value) != 6):
            raise serializers.ValidationError("Pincode must contain exactly 6 digits.")
        return value

    def validate_address(self, value):
        if len(value.strip()) < 5:
            raise serializers.ValidationError("Enter a complete address.")
        return value.strip()

    def validate_pan_number(self, value):
        if not value:
            return value
        value = value.upper()
        if not re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", value): raise serializers.ValidationError("Enter PAN in format ABCDE1234F.")
        return value

    def validate(self, attrs):
        if not attrs.get("country", getattr(self.instance, "country", "")):
            attrs["country"] = "India"
        if not self.partial:
            required = {
                "full_name": "Customer name is required.",
                "group": "Group is required.",
                "primary_mobile": "Phone number is required.",
                "address": "Address is required.",
                "district": "District is required.",
                "state": "State is required.",
                "country": "Country is required.",
            }
            missing = {field: message for field, message in required.items() if not attrs.get(field)}
            if missing:
                raise serializers.ValidationError(missing)
        group = attrs.get("group", getattr(self.instance, "group", None))
        if group is not None:
            role = ROLE_BY_ROOT_NAME.get(group.root().name)
            if role:
                attrs["role"] = role
        phone = attrs.get("primary_mobile", getattr(self.instance, "primary_mobile", ""))
        same = attrs.get("is_whatsapp_same_as_phone", getattr(self.instance, "is_whatsapp_same_as_phone", False))
        whatsapp = attrs.get("whatsapp_number", getattr(self.instance, "whatsapp_number", ""))
        if same:
            attrs["whatsapp_number"] = phone
        elif not whatsapp:
            attrs["whatsapp_number"] = ""
        return attrs


class CustomerKycDocumentSerializer(serializers.ModelSerializer):
    upload_token = serializers.UUIDField(required=False, allow_null=True, write_only=True)
    document_type_display = serializers.CharField(source="get_document_type_display", read_only=True)
    file = serializers.FileField(write_only=True)

    class Meta:
        model = CustomerKycDocument
        # "customer" is deliberately excluded: the view always supplies it from the URL
        # (serializer.save(customer=customer)), never from the request body.
        fields = ("id", "document_type", "document_type_display", "other_document_name",
                   "file", "upload_token", "original_file_name", "file_type", "file_size", "created_at")
        read_only_fields = ("id", "original_file_name", "file_type", "file_size", "created_at")

    def validate_file(self, value):
        return validate_kyc_file(value)

    def validate(self, attrs):
        document_type = attrs.get("document_type", getattr(self.instance, "document_type", ""))
        other_name = attrs.get("other_document_name", getattr(self.instance, "other_document_name", ""))
        if document_type == CustomerKycDocument.DocumentType.OTHER and not str(other_name).strip():
            raise serializers.ValidationError({"other_document_name": "Document Name is required for 'Other'."})
        if document_type != CustomerKycDocument.DocumentType.OTHER:
            attrs["other_document_name"] = ""
        return attrs

    def create(self, validated_data):
        return create_kyc_document(CustomerKycDocument, validated_data)


class CustomerDocumentTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerDocumentType
        fields = ("id", "name")
