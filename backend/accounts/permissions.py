from rest_framework.permissions import BasePermission, SAFE_METHODS

EDIT_DELETE_METHODS = {"PUT", "PATCH", "DELETE"}


def is_admin_user(user):
    return bool(user and user.is_authenticated and (user.is_superuser or user.is_staff))


class IsAdminRole(BasePermission):
    """Full CRUD is reserved for admins; normal users never reach these actions."""
    message = "This action is restricted to administrators."

    def has_permission(self, request, view):
        return is_admin_user(request.user)


class CanWriteFinanceData(BasePermission):
    """View is open to every authenticated user. Create (Entry) additionally requires
    can_write. Edit/Delete (PUT/PATCH/DELETE) are reserved for admins only — a normal
    user's can_write flag grants Entry, never the ability to modify or remove a record
    that already exists."""
    message = "You have view-only access. Contact an administrator for write access."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        if is_admin_user(request.user):
            return True
        if request.method in EDIT_DELETE_METHODS:
            return False
        return bool(getattr(getattr(request.user, "profile", None), "can_write", False))
