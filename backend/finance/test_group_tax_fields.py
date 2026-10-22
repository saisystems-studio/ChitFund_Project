from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Group, MortgageUqc


class GroupTaxFieldTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user("group-admin", is_staff=True))
        self.root = Group.objects.create(name="Tax Root", is_system=True, nature="EXPENSE")

    def test_add_edit_fetch_tax_fields(self):
        created = self.client.post("/api/finance/groups/", {"group_name": "Gold Items", "parent_group_id": self.root.id,
                                                            "hsn_code": " 7113 ", "rate_of_tax": 18, "unit": "Gram", "uqc": "gms"}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        url = f"/api/finance/groups/{created.data['id']}/"
        data = self.client.get(url).data
        self.assertEqual((data["hsn_code"], data["rate_of_tax"], data["unit"], data["uqc"]), ("7113", 18, "Gram", "GMS"))
        edited = self.client.put(url, {"group_name": "Gold Items", "parent_group_id": self.root.id,
                                       "hsn_code": "7114", "rate_of_tax": 5, "unit": "Pcs", "uqc": "nos"}, format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        data = self.client.get(url).data
        self.assertEqual((data["hsn_code"], data["rate_of_tax"], data["unit"], data["uqc"]), ("7114", 5, "Pcs", "NOS"))
        self.assertEqual(data["parent_group_id"], self.root.id)

    def test_fields_optional_and_existing_groups_unchanged(self):
        legacy = Group.objects.create(name="Legacy", parent=self.root)
        data = self.client.get(f"/api/finance/groups/{legacy.id}/").data
        self.assertEqual((data["hsn_code"], data["rate_of_tax"], data["unit"], data["uqc"]), ("", 0, "", ""))
        plain = self.client.post("/api/finance/groups/", {"group_name": "No Tax", "parent_group_id": self.root.id}, format="json")
        self.assertEqual(plain.status_code, 201, plain.data)

    def test_invalid_rate_rejected(self):
        response = self.client.post("/api/finance/groups/", {"group_name": "Bad", "parent_group_id": self.root.id, "rate_of_tax": 7}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_custom_uqc_shared_and_deduplicated(self):
        first = self.client.post("/api/finance/mortgages/uqcs/", {"name": "trl"}, format="json")
        again = self.client.post("/api/finance/mortgages/uqcs/", {"name": "Trl"}, format="json")
        self.assertEqual((first.status_code, first.data["name"]), (201, "TRL"))
        self.assertEqual((again.status_code, again.data["name"]), (200, "TRL"))
        self.assertEqual(MortgageUqc.objects.filter(name__iexact="trl").count(), 1)
        self.assertIn("TRL", self.client.get("/api/finance/mortgages/uqcs/").data)

    def test_group_form_without_unit_uqc_keeps_saved_values(self):
        created = self.client.post("/api/finance/groups/", {"group_name": "Silver Items", "parent_group_id": self.root.id,
                                   "hsn_code": "7106", "rate_of_tax": 5, "unit": "Gram", "uqc": "GMS"}, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        url = f"/api/finance/groups/{created.data['id']}/"
        # The Add/Edit Group form no longer sends Unit / UQC.
        edited = self.client.put(url, {"group_name": "Silver Items", "parent_group_id": self.root.id, "hsn_code": "7107", "rate_of_tax": 12}, format="json")
        self.assertEqual(edited.status_code, 200, edited.data)
        data = self.client.get(url).data
        self.assertEqual((data["hsn_code"], data["rate_of_tax"], data["unit"], data["uqc"]), ("7107", 12, "Gram", "GMS"))
        plain = self.client.post("/api/finance/groups/", {"group_name": "Plain", "parent_group_id": self.root.id, "hsn_code": "", "rate_of_tax": 0}, format="json")
        self.assertEqual(plain.status_code, 201, plain.data)

    def test_tax_fields_only_kept_under_income_or_expense_roots(self):
        asset = Group.objects.create(name="Current Assets", is_system=True, nature="ASSET")
        income = Group.objects.create(name="Direct Income", is_system=True, nature="INCOME")
        payload = {"group_name": "Shop", "hsn_code": "9983", "rate_of_tax": 18}
        hidden = self.client.post("/api/finance/groups/", {**payload, "parent_group_id": asset.id}, format="json")
        self.assertEqual(hidden.status_code, 201, hidden.data)
        self.assertEqual((hidden.data["hsn_code"], hidden.data["rate_of_tax"]), ("", 0))
        shown = self.client.post("/api/finance/groups/", {**payload, "parent_group_id": income.id}, format="json")
        self.assertEqual((shown.data["hsn_code"], shown.data["rate_of_tax"]), ("9983", 18))
        # A sub-group inherits its root's category, at any depth.
        nested = self.client.post("/api/finance/groups/", {**payload, "group_name": "Counter", "parent_group_id": shown.data["id"]}, format="json")
        self.assertEqual((nested.data["hsn_code"], nested.data["rate_of_tax"]), ("9983", 18))
        # Moving an eligible group under a non-eligible tag drops its tax values.
        moved = self.client.put(f"/api/finance/groups/{shown.data['id']}/", {**payload, "group_name": "Shop Moved", "parent_group_id": asset.id}, format="json")
        self.assertEqual((moved.data["hsn_code"], moved.data["rate_of_tax"]), ("", 0))
