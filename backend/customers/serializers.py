import re
from datetime import date
from rest_framework import serializers
from .models import Customer

class CustomerSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    class Meta:
        model = Customer
        fields = "__all__"
        read_only_fields = ("id", "customer_code", "created_at", "updated_at", "role_display")

    def validate_primary_mobile(self, value):
        if not value.isdigit() or len(value) != 10:
            raise serializers.ValidationError("Phone number must contain exactly 10 digits.")
        return value

    def validate_full_name(self, value):
        value = " ".join(value.strip().split())
        if len(value) < 2 or not re.fullmatch(r"[A-Za-z .'-]+", value):
            raise serializers.ValidationError("Enter a valid name with at least 2 letters.")
        return value

    def validate_role(self, value):
        if value not in {item[0] for item in Customer.Role.choices}:
            raise serializers.ValidationError("Select Debtor, Creditor or Debtor & Creditor.")
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
        value = value.upper()
        if not re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", value): raise serializers.ValidationError("Enter PAN in format ABCDE1234F.")
        return value

    def validate(self, attrs):
        if not self.partial:
            required = {
                "full_name": "Customer name is required.",
                "role": "Customer role is required.",
                "primary_mobile": "Phone number is required.",
                "alternate_mobile": "Alternative phone number is required.",
                "dob": "Date of birth is required.",
                "aadhaar_number": "Aadhaar number is required.",
                "pan_number": "PAN number is required.",
                "address": "Address is required.",
                "district": "District is required.",
                "state": "State is required.",
                "country": "Country is required.",
            }
            missing = {field: message for field, message in required.items() if not attrs.get(field)}
            if missing:
                raise serializers.ValidationError(missing)
        phone = attrs.get("primary_mobile", getattr(self.instance, "primary_mobile", ""))
        same = attrs.get("is_whatsapp_same_as_phone", getattr(self.instance, "is_whatsapp_same_as_phone", False))
        whatsapp = attrs.get("whatsapp_number", getattr(self.instance, "whatsapp_number", ""))
        if same:
            attrs["whatsapp_number"] = phone
        elif not whatsapp:
            attrs["whatsapp_number"] = ""
        return attrs
