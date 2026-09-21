from django.contrib import admin
from .models import Customer

@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("customer_code", "full_name", "primary_mobile", "role", "is_active")
    search_fields = ("customer_code", "full_name", "primary_mobile")
    list_filter = ("role", "is_active")
