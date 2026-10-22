from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from accounts.permissions import CanWriteFinanceData, is_admin_user
from customers.kyc_security import CanAccessKycDocuments, secure_kyc_response
from .document_serializers import StaffKycDocumentSerializer
from .models import Staff, StaffKycDocument
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


# Staff KYC / ID documents. Same access rule as customer and loan KYC: administrators or
# users with Entry access may list, view and attach. Removing a saved document is an
# Edit/Delete action, so (like every other record) it is reserved for administrators.
@api_view(["GET", "POST"])
@permission_classes([CanAccessKycDocuments])
def staff_kyc_documents(request, staff_id):
    staff = get_object_or_404(Staff, pk=staff_id)
    if request.method == "POST":
        serializer = StaffKycDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(staff=staff)
        return Response(serializer.data, status=201)
    return Response(StaffKycDocumentSerializer(staff.kyc_documents.all(), many=True).data)


@api_view(["DELETE"])
@permission_classes([CanAccessKycDocuments])
def staff_kyc_document_detail(request, staff_id, document_id):
    if not is_admin_user(request.user):
        raise PermissionDenied("Only administrators can delete a saved document.")
    get_object_or_404(StaffKycDocument, pk=document_id, staff_id=staff_id).delete()
    return Response(status=204)


@api_view(["GET"])
@permission_classes([CanAccessKycDocuments])
def staff_kyc_document_file(request, staff_id, document_id):
    # Scoped to the staff id in the path so one staff member's document link can never
    # be swapped onto another's -- same guarantee as the customer/loan file endpoints.
    document = get_object_or_404(StaffKycDocument, pk=document_id, staff_id=staff_id)
    try:
        handle = document.file.open("rb")
    except FileNotFoundError:
        raise Http404("Document file is missing.")
    response = FileResponse(handle, as_attachment=bool(request.query_params.get("download")),
                            filename=document.original_file_name,
                            content_type=document.file_type or "application/octet-stream")
    return secure_kyc_response(response)
