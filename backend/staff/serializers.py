from rest_framework import serializers
from .models import Staff


class StaffSerializer(serializers.ModelSerializer):
    class Meta:
        model = Staff
        fields = "__all__"
        read_only_fields = ("id", "staff_id", "created_at", "updated_at")

    def validate_staff_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Staff name is required.")
        return value

    def validate_phone_number(self, value):
        if not value or len(value) != 10 or not value.isdigit():
            raise serializers.ValidationError("Enter a valid 10-digit phone number.")
        return value

    def validate_alternative_phone_number(self, value):
        if value and (len(value) != 10 or not value.isdigit()):
            raise serializers.ValidationError("Enter a valid 10-digit phone number.")
        return value

    def validate_aadhaar_number(self, value):
        if value and (len(value) != 12 or not value.isdigit()):
            raise serializers.ValidationError("Enter a valid 12-digit Aadhaar number.")
        return value


class DoneBySerializerMixin(serializers.Serializer):
    """Mixin for master serializers exposing a `done_by_staff` FK: adds a
    read-only display name alongside the id so API responses carry both,
    without ever requiring the client to resolve the name itself."""
    done_by_staff_name = serializers.SerializerMethodField()

    def get_done_by_staff_name(self, obj):
        staff = getattr(obj, "done_by_staff", None)
        return staff.staff_name if staff else None
