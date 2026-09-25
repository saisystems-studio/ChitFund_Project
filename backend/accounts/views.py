from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from rest_framework import status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import CompanyProfile, UserProfile
from .serializers import CompanyProfileSerializer, LoginSerializer, UserAccountSerializer
from .temporary_auth import temporary_credentials_match, temporary_user_data, issue_temporary_token


PROFILE_FIELDS = ("company_name", "logo", "address", "phone", "email")


def company_profile_data(profile):
    return {field: getattr(profile, field) if profile else "" for field in PROFILE_FIELDS}


class CompanyProfileView(APIView):
    def get_permissions(self):
        return [AllowAny()] if self.request.method in ("GET", "HEAD", "OPTIONS") else [IsAdminUser()]

    def get(self, request):
        profile = CompanyProfile.objects.filter(pk=1).first()
        return Response(company_profile_data(profile), headers={"Cache-Control": "no-store"})

    def patch(self, request):
        serializer = CompanyProfileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        if values.pop("remove_logo", False):
            values["logo"] = ""
        profile, _ = CompanyProfile.objects.update_or_create(pk=1, defaults=values)
        return Response(company_profile_data(profile), headers={"Cache-Control": "no-store"})

@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    data = LoginSerializer(data=request.data)
    data.is_valid(raise_exception=True)
    if temporary_credentials_match(data.validated_data["username"], data.validated_data["password"]):
        return Response({"token": issue_temporary_token(), "user": temporary_user_data()})
    user = authenticate(username=data.validated_data["username"], password=data.validated_data["password"])
    if not user or not user.is_active:
        return Response({"detail": "Invalid username or password."}, status=status.HTTP_401_UNAUTHORIZED)
    profile, _ = UserProfile.objects.get_or_create(user=user)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": {"id": user.id, "username": user.username, "is_admin": user.is_superuser or user.is_staff, "can_write": user.is_superuser or user.is_staff or profile.can_write}})

@api_view(["GET"])
def me(request):
    if getattr(request.user, "is_temporary_admin", False):
        return Response(temporary_user_data())
    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    return Response({"id": request.user.id, "username": request.user.username, "is_admin": request.user.is_superuser or request.user.is_staff, "can_write": request.user.is_superuser or request.user.is_staff or profile.can_write})

class UserAccountViewSet(viewsets.ModelViewSet):
    queryset = User.objects.filter(is_superuser=False).order_by("username")
    serializer_class = UserAccountSerializer
    permission_classes = [IsAdminUser]
