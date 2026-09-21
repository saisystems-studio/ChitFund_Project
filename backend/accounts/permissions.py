from rest_framework.permissions import BasePermission, SAFE_METHODS

class CanWriteFinanceData(BasePermission):
    message = "You have view-only access. Contact an administrator for write access."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        if request.user.is_superuser or request.user.is_staff:
            return True
        return bool(getattr(getattr(request.user, "profile", None), "can_write", False))
