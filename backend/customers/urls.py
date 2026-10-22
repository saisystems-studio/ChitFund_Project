from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import CustomerViewSet, customer_document_types, customer_kyc_document_detail, customer_kyc_document_file, customer_kyc_documents, dashboard, district_search, location_search

router = DefaultRouter()
router.register("customers", CustomerViewSet, basename="customer")
urlpatterns = [
    path("", include(router.urls)),
    path("customers/<int:customer_id>/kyc-documents/", customer_kyc_documents),
    path("customers/<int:customer_id>/kyc-documents/<int:document_id>/", customer_kyc_document_detail),
    path("customers/<int:customer_id>/kyc-documents/<int:document_id>/file/", customer_kyc_document_file),
    path("customer-document-types/", customer_document_types),
    path("dashboard/", dashboard), path("districts/", district_search), path("locations/", location_search),
]
