from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import CustomerViewSet, dashboard, district_search, location_search

router = DefaultRouter()
router.register("customers", CustomerViewSet, basename="customer")
urlpatterns = [path("", include(router.urls)), path("dashboard/", dashboard), path("districts/", district_search), path("locations/", location_search)]
