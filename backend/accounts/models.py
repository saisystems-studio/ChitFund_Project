from django.conf import settings
from django.db import models

class UserProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    # Default Entry + View for newly created profiles. This is a schema-level default
    # for future rows only — it does not rewrite can_write on any existing UserProfile,
    # so previously created accounts keep whatever access they already have.
    can_write = models.BooleanField(default=True)
    display_role = models.CharField(max_length=30, default="Staff")

    def __str__(self):
        return self.user.username


class CompanyProfile(models.Model):
    # A single application-wide profile, independent of the signed-in user.
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    company_name = models.CharField(max_length=200, blank=True, default="")
    logo = models.TextField(blank=True, default="")
    address = models.TextField(blank=True, default="")
    phone = models.CharField(max_length=50, blank=True, default="")
    email = models.CharField(max_length=254, blank=True, default="")
