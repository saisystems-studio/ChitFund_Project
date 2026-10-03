from django.db import transaction
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.pagination import PageNumberPagination
from accounts.permissions import CanWriteFinanceData
from .models import Staff
from .serializers import StaffSerializer


class StaffPagination(PageNumberPagination):
    page_size_query_param = "page_size"
    max_page_size = 10000


class StaffViewSet(viewsets.ModelViewSet):
    queryset = Staff.objects.all()
    serializer_class = StaffSerializer
    pagination_class = StaffPagination
    permission_classes = [CanWriteFinanceData]

    def get_queryset(self):
        queryset = super().get_queryset()
        is_active = self.request.query_params.get("is_active")
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() in ("1", "true", "yes"))
        search = self.request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(Q(staff_name__icontains=search) | Q(staff_id__icontains=search) | Q(phone_number__icontains=search))
        return queryset

    @transaction.atomic
    def perform_create(self, serializer):
        number = (Staff.objects.order_by("-id").values_list("id", flat=True).first() or 0) + 1
        serializer.save(staff_id=f"STF-{number:04d}")
