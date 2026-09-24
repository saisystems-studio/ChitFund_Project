from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import LedgerViewSet, PaymentEntryViewSet, mortgage_report, customer_wise_report
from .views import (LoanTypeViewSet, LoanInstallmentViewSet, MortgageViewSet, ChitGroupViewSet,
    ChitGroupInstallmentDetailViewSet, CustomerLoanDetailsViewSet, InterestDetailsViewSet,
    CustomerChitDetailsViewSet, HolidayMasterViewSet, LoanHolidaySettingsViewSet,
    CustomerLoanInstallmentDetailsViewSet, preview_chit_schedule, payments_compatibility,
    day_wise_report, loan_wise_report, customer_collection_report, collections_list,
    collections_summary, collections_create_endpoint, collection_history, previous_pending, collections_endpoint, adjustment_types)
router = DefaultRouter()
router.register('ledgers', LedgerViewSet, basename='ledger')
router.register('payment-entries', PaymentEntryViewSet, basename='payment-entry')
for prefix, view, name in [("loan-types", LoanTypeViewSet, "loan-type"), ("loan-installments", LoanInstallmentViewSet, "loan-installment"), ("mortgages", MortgageViewSet, "mortgage"), ("chit-groups", ChitGroupViewSet, "chit-group"), ("chit-group-installments", ChitGroupInstallmentDetailViewSet, "chit-group-installment"), ("loans", CustomerLoanDetailsViewSet, "loan"), ("customer-loans", CustomerLoanDetailsViewSet, "customer-loan-details"), ("interest-details", InterestDetailsViewSet, "interest-details"), ("customer-chit-details", CustomerChitDetailsViewSet, "customer-chit-details"), ("customer-loan-installments", CustomerLoanInstallmentDetailsViewSet, "customer-loan-installment"), ("due-schedules", CustomerLoanInstallmentDetailsViewSet, "due-schedule"), ("holidays", HolidayMasterViewSet, "holiday"), ("loan-holiday-settings", LoanHolidaySettingsViewSet, "loan-holiday-setting")]: router.register(prefix, view, basename=name)
urlpatterns = [path("reports/mortgage/", mortgage_report), path("reports/customer-wise/", customer_wise_report), path("adjustment-types/", adjustment_types), path("chit-loans/preview-schedule/", preview_chit_schedule), path("payments/", payments_compatibility), path("collections/", collections_endpoint), path("collections/summary/", collections_summary), path("collections/previous-pending/", previous_pending), path("collections/create/", collections_create_endpoint), path("collection-history/", collection_history), path("reports/day-wise/", day_wise_report), path("reports/loan-wise/", loan_wise_report), path("reports/customer/<int:customer_id>/", customer_collection_report), path("", include(router.urls))]
