from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import UserAccountViewSet, login, me

router = DefaultRouter()
router.register("users", UserAccountViewSet, basename="user-account")
urlpatterns = [path("login/", login), path("me/", me), path("", include(router.urls))]
