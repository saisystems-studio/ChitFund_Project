from django.conf import settings
from django.db import models

class UserProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    can_write = models.BooleanField(default=False)
    display_role = models.CharField(max_length=30, default="Staff")

    def __str__(self):
        return self.user.username
