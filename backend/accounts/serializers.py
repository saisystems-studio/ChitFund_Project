import base64
import warnings
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError
from django.contrib.auth.models import User
from rest_framework import serializers
from .models import UserProfile


class CompanyProfileSerializer(serializers.Serializer):
    company_name = serializers.CharField(max_length=200, allow_blank=True, required=False)
    address = serializers.CharField(max_length=500, allow_blank=True, required=False)
    phone = serializers.CharField(max_length=50, allow_blank=True, required=False)
    email = serializers.EmailField(max_length=254, allow_blank=True, required=False)
    logo = serializers.FileField(required=False, write_only=True)
    remove_logo = serializers.BooleanField(required=False, default=False, write_only=True)

    def validate_logo(self, upload):
        if Path(upload.name).suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            raise serializers.ValidationError("Choose a PNG, JPG or JPEG image.")
        if upload.size > 2 * 1024 * 1024:
            raise serializers.ValidationError("Logo must be 2 MB or smaller.")
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(upload) as image:
                    image_format = image.format
                    if image_format not in {"PNG", "JPEG"}:
                        raise serializers.ValidationError("Choose a valid PNG, JPG or JPEG image.")
                    if image.width > 4096 or image.height > 4096:
                        raise serializers.ValidationError("Logo dimensions must not exceed 4096 × 4096 pixels.")
                    image.verify()
                upload.seek(0)
                with Image.open(upload) as image:
                    image.load()
                    output = BytesIO()
                    # Re-encode validated pixels rather than retaining uploaded metadata.
                    image.convert("RGBA" if image_format == "PNG" else "RGB").save(output, format=image_format)
        except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise serializers.ValidationError("Choose a valid PNG, JPG or JPEG image.")
        if output.tell() > 2 * 1024 * 1024:
            raise serializers.ValidationError("Logo must be 2 MB or smaller after processing.")
        encoded = base64.b64encode(output.getvalue()).decode("ascii")
        return f"data:image/{image_format.lower()};base64,{encoded}"

    def validate(self, attrs):
        if attrs.get("remove_logo") and "logo" in attrs:
            raise serializers.ValidationError({"logo": "Upload a logo or remove it, not both."})
        return attrs

class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)

class UserAccountSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=4)
    can_write = serializers.BooleanField(source="profile.can_write", required=False)
    display_role = serializers.CharField(source="profile.display_role", required=False)
    class Meta:
        model = User
        fields = ("id", "username", "first_name", "last_name", "email", "is_active", "can_write", "display_role", "password")
        read_only_fields = ("id",)

    def create(self, validated_data):
        profile_data = validated_data.pop("profile", {})
        password = validated_data.pop("password", None)
        user = User.objects.create_user(password=password, **validated_data)
        UserProfile.objects.create(user=user, **profile_data)
        return user

    def update(self, instance, validated_data):
        profile_data = validated_data.pop("profile", {})
        password = validated_data.pop("password", None)
        for key, value in validated_data.items(): setattr(instance, key, value)
        if password: instance.set_password(password)
        instance.save()
        profile, _ = UserProfile.objects.get_or_create(user=instance)
        for key, value in profile_data.items(): setattr(profile, key, value)
        profile.save()
        return instance
