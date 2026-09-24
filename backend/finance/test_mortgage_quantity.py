from decimal import Decimal
from types import SimpleNamespace

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from .models import Mortgage
from .serializers import MortgageSerializer
from .views import MortgageViewSet


class MortgageQuantityTests(TestCase):
    def test_product_crud_round_trip(self):
        def request(action, method, data=None, pk=None):
            req = getattr(APIRequestFactory(), method)("/", data or {}, format="json")
            force_authenticate(req, user=SimpleNamespace(is_authenticated=True, is_staff=True, is_superuser=True))
            return MortgageViewSet.as_view({method: action})(req, **({"pk": pk} if pk else {}))

        payload = {"product_name": "CRUD Gold", "quantity": "2.125", "unit": "Gram",
                   "current_rate": "100", "rate_date": "2026-09-23"}
        created = request("create", "post", payload)
        self.assertEqual(created.status_code, 201, created.data)
        pk = created.data["id"]
        detail = request("retrieve", "get", pk=pk)
        self.assertEqual(detail.data["quantity"], "2.125")
        edited = request("update", "put", {**payload, "product_name": "Updated Gold", "quantity": "3.500"}, pk)
        self.assertEqual(edited.status_code, 200, edited.data)
        product = Mortgage.objects.get(pk=pk)
        self.assertEqual(product.product_name, "Updated Gold")
        self.assertEqual(product.quantity, Decimal("3.500"))
        deleted = request("destroy", "delete", pk=pk)
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(Mortgage.objects.filter(pk=pk).exists())
        self.assertEqual(request("list", "get").data, [])

    def test_quantity_is_saved_and_preserved_when_edit_omits_it(self):
        serializer = MortgageSerializer(data={
            "product_name": "Gold", "quantity": "2.125", "unit": "Gram",
            "current_rate": "100", "rate_date": "2026-09-23",
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        product = serializer.save()
        product = Mortgage.objects.get(pk=product.pk)
        self.assertEqual(product.quantity, Decimal("2.125"))
        self.assertEqual(MortgageSerializer(product).data["quantity"], "2.125")
        edit = MortgageSerializer(product, data={"product_name": "Gold updated"}, partial=True)
        self.assertTrue(edit.is_valid(), edit.errors)
        edit.save()
        product.refresh_from_db()
        self.assertEqual(product.quantity, Decimal("2.125"))
