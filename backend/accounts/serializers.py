from django.contrib.auth.models import User
from rest_framework import serializers
from .models import UserProfile

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
