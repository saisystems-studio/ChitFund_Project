from django.db import models


class Staff(models.Model):
    class Gender(models.TextChoices):
        MALE = "Male", "Male"
        FEMALE = "Female", "Female"
        OTHER = "Other", "Other"

    id = models.AutoField(primary_key=True)
    staff_id = models.CharField(max_length=20, unique=True, editable=False, db_index=True)
    staff_name = models.CharField(max_length=150, db_index=True)
    phone_number = models.CharField(max_length=15, db_index=True)
    alternative_phone_number = models.CharField(max_length=15, blank=True)
    aadhaar_number = models.CharField(max_length=12, blank=True, db_index=True)
    address = models.TextField(blank=True)
    gender = models.CharField(max_length=10, choices=Gender.choices, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "staff_tbl"
        ordering = ["staff_name"]
        verbose_name_plural = "staff"

    def __str__(self):
        return f"{self.staff_name} - {self.staff_id}"
