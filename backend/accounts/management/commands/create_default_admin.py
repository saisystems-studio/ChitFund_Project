from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from accounts.models import UserProfile

class Command(BaseCommand):
    help = "Create or update the development admin account."
    def handle(self, *args, **options):
        user, created = User.objects.get_or_create(username="admin", defaults={"is_staff": True, "is_superuser": True, "email": "admin@example.com"})
        user.is_staff = True
        user.is_superuser = True
        user.is_active = True
        user.set_password("123")
        user.save()
        UserProfile.objects.update_or_create(user=user, defaults={"can_write": True, "display_role": "Administrator"})
        self.stdout.write(self.style.SUCCESS("Demo admin ready: username=admin password=123"))
