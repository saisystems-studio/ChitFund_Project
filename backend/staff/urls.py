from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import StaffViewSet, staff_kyc_document_detail, staff_kyc_document_file, staff_kyc_documents

router = DefaultRouter()
router.register("staff", StaffViewSet, basename="staff")
urlpatterns = [
    path("staff/<int:staff_id>/kyc-documents/", staff_kyc_documents),
    path("staff/<int:staff_id>/kyc-documents/<int:document_id>/", staff_kyc_document_detail),
    path("staff/<int:staff_id>/kyc-documents/<int:document_id>/file/", staff_kyc_document_file),
    path("", include(router.urls)),
]
