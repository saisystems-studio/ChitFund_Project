from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from rest_framework import status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from .models import UserProfile
from .serializers import LoginSerializer, UserAccountSerializer
from .temporary_auth import temporary_credentials_match, temporary_user_data, issue_temporary_token

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
