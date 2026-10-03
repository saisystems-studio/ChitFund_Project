from django.contrib import admin
from .models import Staff

@admin.register(Staff)
class StaffAdmin(admin.ModelAdmin):
    list_display = ("staff_id", "staff_name", "phone_number", "is_active")
    search_fields = ("staff_id", "staff_name", "phone_number")
    list_filter = ("is_active", "gender")
