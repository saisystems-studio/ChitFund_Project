from rest_framework import status, viewsets
from django.db import transaction
from django.db.models import ProtectedError
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from django.db.models import Q
from django.db.models.functions import Lower
from .models import CountryMaster, Customer, CustomerDocumentType, CustomerKycDocument, DistrictMaster, StateMaster
from .serializers import CustomerDocumentTypeSerializer, CustomerKycDocumentSerializer, CustomerSerializer
from customers.kyc_security import CanAccessKycDocuments, secure_kyc_response
from accounts.permissions import CanWriteFinanceData, is_admin_user
from rest_framework.exceptions import PermissionDenied
from finance.delete_utils import delete_response

class CustomerViewSet(viewsets.ModelViewSet):
    pagination_class = None
    queryset = Customer.objects.select_related("group", "done_by_staff").prefetch_related("ledgers").filter(is_active=True)
    serializer_class = CustomerSerializer
    search_fields = ("customer_code", "full_name", "primary_mobile")
    ordering_fields = ("full_name", "customer_code", "created_at")
    permission_classes = [CanWriteFinanceData]

    def filter_queryset(self, queryset):
        return super().filter_queryset(queryset).order_by(Lower("full_name"), "id")

    @action(detail=False, methods=["get"], url_path="next-code")
    def next_code(self, request):
        last = Customer.objects.order_by("-id").values_list("id", flat=True).first() or 0
        next_value = last + 1
        return Response({"customer_code": f"CUS_{next_value:03d}", "preview": True})

    @action(detail=False, methods=["get"], url_path="search")
    def search_customers(self, request):
        query = request.query_params.get("q", "").strip()
        if len(query) < 2:
            return Response([])
        customers = self.get_queryset().filter(
            Q(full_name__icontains=query) |
            Q(customer_code__icontains=query) |
            Q(primary_mobile__icontains=query) |
            Q(alternate_mobile__icontains=query) |
            Q(whatsapp_number__icontains=query)
        ).order_by("full_name")[:10]
        return Response([{
            "id": customer.id,
            "customer_code": customer.customer_code,
            "customer_name": customer.full_name,
            "phone": customer.primary_mobile,
        } for customer in customers])

    @transaction.atomic
    def perform_create(self, serializer):
        number = (Customer.objects.order_by("-id").values_list("id", flat=True).first() or 0) + 1
        serializer.save(customer_code=f"CUS_{number:03d}")

    def get_queryset(self):
        queryset = Customer.objects.select_related("group", "done_by_staff").prefetch_related("ledgers").filter(is_active=True)
        role = self.request.query_params.get("role")
        search = self.request.query_params.get("search")
        if role: queryset = queryset.filter(role=role.upper())
        if search: queryset = queryset.filter(full_name__icontains=search) | queryset.filter(customer_code__icontains=search) | queryset.filter(primary_mobile__icontains=search)
        return queryset.order_by("full_name")

    def destroy(self, request, *args, **kwargs):
        return delete_response(self.get_object(), "customer")


@api_view(["GET"])
def district_search(request):
    query = request.query_params.get("q", "").strip()
    districts = DistrictMaster.objects.select_related("state__country").all()
    if query:
        districts = districts.filter(name__icontains=query)
    return Response([{
        "id": item.id,
        "name": item.name,
        "state": item.state.name,
        "country": item.state.country.name,
        "pincode": item.pincode or "",
    } for item in districts[:25]])


@api_view(["GET"])
def location_search(request):
    query = request.query_params.get("q", "").strip()
    kind = request.query_params.get("type", "district").lower()
    if kind == "country":
        rows = CountryMaster.objects.filter(name__icontains=query).order_by("name")[:50]
        return Response([{"id": row.id, "name": row.name} for row in rows])
    if kind == "state":
        rows = StateMaster.objects.select_related("country").filter(name__icontains=query).order_by("name")[:50]
        return Response([{"id": row.id, "name": row.name, "country": row.country.name} for row in rows])
    rows = DistrictMaster.objects.select_related("state__country").filter(name__icontains=query).order_by("name", "state__name")[:50]
    seen = set()
    result = []
    for row in rows:
        identity = (row.name.casefold(), row.state.name.casefold(), row.state.country.name.casefold())
        if identity in seen:
            continue
        seen.add(identity)
        result.append({"id": row.id, "name": row.name, "state": row.state.name, "country": row.state.country.name, "pincode": row.pincode or ""})
    return Response(result)

@api_view(["GET", "POST"])
@permission_classes([CanAccessKycDocuments])
def customer_kyc_documents(request, customer_id):
    customer = get_object_or_404(Customer, pk=customer_id, is_active=True)
    if request.method == "POST":
        serializer = CustomerKycDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(customer=customer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    documents = customer.kyc_documents.all()
    return Response(CustomerKycDocumentSerializer(documents, many=True).data)


# Removing a saved customer document (Edit Customer). Same rule as Staff documents:
# an Edit/Delete action, so it is reserved for administrators.
@api_view(["DELETE"])
@permission_classes([CanAccessKycDocuments])
def customer_kyc_document_detail(request, customer_id, document_id):
    if not is_admin_user(request.user):
        raise PermissionDenied("Only administrators can delete a saved document.")
    get_object_or_404(CustomerKycDocument, pk=document_id, customer_id=customer_id, customer__is_active=True).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([CanWriteFinanceData])
def customer_document_types(request):
    # Built-in types live in CustomerKycDocument.DocumentType; this only lists the
    # custom "Other" names customers have actually used, for the ID Proof dropdown.
    types = CustomerDocumentType.objects.order_by("name")
    return Response(CustomerDocumentTypeSerializer(types, many=True).data)


@api_view(["GET"])
@permission_classes([CanAccessKycDocuments])
def customer_kyc_document_file(request, customer_id, document_id):
    # Every document is served only through this authenticated endpoint â€” never a raw
    # media URL â€” and is scoped to the customer id in the path, not just the document id,
    # so one customer's document link can never be swapped onto another customer.
    document = get_object_or_404(CustomerKycDocument, pk=document_id, customer_id=customer_id, customer__is_active=True)
    try:
        handle = document.file.open("rb")
    except FileNotFoundError:
        raise Http404("Document file is missing.")
    response = FileResponse(handle, as_attachment=bool(request.query_params.get("download")),
                            filename=document.original_file_name,
                            content_type=document.file_type or "application/octet-stream")
    return secure_kyc_response(response)


@api_view(["GET"])
def dashboard(request):
    qs = Customer.objects.filter(is_active=True)
    return Response({"total_customers": qs.count(), "lenders": qs.filter(role__in=["LENDER", "BOTH"]).count(), "borrowers": qs.filter(role__in=["BORROWER", "BOTH"]).count(), "both_roles": qs.filter(role="BOTH").count()})
