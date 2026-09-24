from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from django.test import TestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIRequestFactory, force_authenticate

from customers.models import Customer
from customers.serializers import CustomerSerializer
from customers.views import CustomerViewSet
from .models import (ChitGroup, CustomerLoanDetails, CustomerLoanInstallmentDetails,
                     CollectionTransaction, LoanType, LoanInstallment, Mortgage, MortgageRate, MortgageLoanDetails, HolidayMaster)
from .serializers import MortgageSerializer
from .services import save_installments_preserving_payments
from .views import ChitGroupViewSet, MortgageViewSet, HolidayMasterViewSet, LoanInstallmentViewSet, CustomerLoanDetailsViewSet


class RequestedFixTests(TestCase):
    def test_chit_amount_dates_activation_and_loan_schedule(self):
        customer = self.customer()
        loan_type = LoanType.objects.create(name="Chit")
        payload = {"code": "TEST", "name": "Saved group", "duration": 20, "duration_type": "DAY",
                   "start_date": "2026-09-23", "end_date": "2026-10-31", "total_amount": "100000",
                   "installments": [{"installment_number": n, "schedule_value": f"Saved {n}", "installment_amount": "4000"} for n in range(1, 21)]}
        response = self.request(ChitGroupViewSet, "create", "post", payload)
        self.assertEqual(response.status_code, 201, response.data)
        group = ChitGroup.objects.get(pk=response.data["id"])
        self.assertEqual(group.grand_total, Decimal("100000"))
        self.assertEqual(group.end_date, date(2026, 10, 31))
        loan_payload = {"customer_id": customer.id, "loan_type_id": loan_type.id, "chit_group_id": group.id,
                        "amount": "100000", "start_date": "2026-09-23", "include_sunday": True}
        response = self.request(CustomerLoanDetailsViewSet, "create", "post", loan_payload)
        self.assertEqual(response.status_code, 201, response.data)
        loan = CustomerLoanDetails.objects.get(pk=response.data["id"])
        self.assertEqual(loan.loan_amount, Decimal("100000"))
        self.assertEqual(loan.total_amount, Decimal("80000"))
        self.assertEqual(list(loan.installment_details.order_by("installment_number").values_list("installment_amount", flat=True)), [Decimal("4000")] * 20)
        response = self.request(ChitGroupViewSet, "partial_update", "patch", {"is_active": False}, group.id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.request(CustomerLoanDetailsViewSet, "create", "post", loan_payload).status_code, 400)
        self.assertEqual(self.request(CustomerLoanDetailsViewSet, "update", "put", loan_payload, loan.id).status_code, 200)
        other = ChitGroup.objects.create(code="INACTIVE", name="Other", duration=20, duration_type="DAY", is_active=False)
        self.assertEqual(self.request(CustomerLoanDetailsViewSet, "update", "put", {**loan_payload, "chit_group_id": other.id}, loan.id).status_code, 400)
        active = ChitGroup.objects.create(code="ACTIVE", name="Active", duration=1, duration_type="DAY")
        rows = self.request(ChitGroupViewSet, "list", "get").data
        self.assertEqual(rows[0]["id"], active.id)
        self.assertEqual(self.request(ChitGroupViewSet, "partial_update", "patch", {"is_active": True}, group.id).status_code, 200)
        group.refresh_from_db()
        self.assertTrue(group.is_active)
        self.assertEqual(group.start_date, date(2026, 9, 23))
        self.assertEqual(group.end_date, date(2026, 10, 31))
        self.assertEqual(group.installments.count(), 20)

    def test_interest_duration_type_round_trip_and_100_days(self):
        customer = self.customer()
        loan_type = LoanType.objects.create(name="Interest")
        LoanInstallment.objects.create(name="100 Days", code="100DAYS")
        payload = {"customer_id": customer.id, "loan_type_id": loan_type.id, "amount": "10000",
                   "interest_percentage": "10", "interest_duration": 100, "interest_duration_type": "DAY",
                   "periodicity": "100 Days", "start_date": "2026-09-23", "include_sunday": True}
        response = self.request(CustomerLoanDetailsViewSet, "create", "post", payload)
        self.assertEqual(response.status_code, 201, response.data)
        loan = CustomerLoanDetails.objects.get(pk=response.data["id"])
        self.assertEqual(loan.installment_details.count(), 100)
        self.assertEqual(loan.total_amount, Decimal("11000"))
        self.assertEqual(response.data["interest_details"]["duration_type"], "DAY")
        response = self.request(CustomerLoanDetailsViewSet, "update", "put", {**payload, "interest_duration_type": "WEEK"}, loan.id)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["interest_details"]["duration_type"], "WEEK")

    def request(self, view, action, method, payload=None, pk=None, query=""):
        request = getattr(APIRequestFactory(), method)("/" + query, payload or {}, format="json")
        force_authenticate(request, user=SimpleNamespace(is_authenticated=True, is_staff=True, is_superuser=True))
        return view.as_view({method: action})(request, **({"pk": pk} if pk else {}))

    def customer(self, code="TEST", name="Alice", phone="9876543210"):
        return Customer.objects.create(customer_code=code, full_name=name, primary_mobile=phone,
                                       role="BORROWER", address="Test address", district="Chennai", state="Tamil Nadu")

    def test_optional_dob_and_country_and_partial_edit(self):
        customer = self.customer()
        for dob in ("", None, "2000-01-15"):
            serializer = CustomerSerializer(customer, data={"dob": dob, "country": ""}, partial=True)
            self.assertTrue(serializer.is_valid(), serializer.errors)
            serializer.save()
        response = self.request(CustomerViewSet, "partial_update", "patch", {"email": "alice@example.com"}, customer.pk)
        self.assertEqual(response.status_code, 200)
        customer.refresh_from_db()
        self.assertEqual(customer.dob, date(2000, 1, 15))
        self.assertEqual(customer.country, "India")
        self.assertEqual(customer.full_name, "Alice")
        self.assertEqual(customer.primary_mobile, "9876543210")
        for dob in ("bad", "2000-02-30", "2999-01-01"):
            serializer = CustomerSerializer(customer, data={"dob": dob}, partial=True)
            self.assertFalse(serializer.is_valid())

    def test_customers_sorted_even_when_reverse_requested(self):
        self.customer("Z", "zed", "9876543211")
        self.customer("A", "Alice")
        response = self.request(CustomerViewSet, "list", "get", query="?ordering=-full_name")
        rows = response.data.get("results", []) if isinstance(response.data, dict) else response.data
        self.assertEqual([row["full_name"] for row in rows], ["Alice", "zed"])

    def test_chit_saved_dates_schedule_total_and_edit(self):
        payload = {"code": "CHG_TEST", "name": "Test Group", "duration": 2, "duration_type": "MONTH",
                   "start_date": "2026-09-23", "collection_day": 25,
                   "installments": [{"installment_number": n, "schedule_value": f"Saved {n}", "installment_amount": "100.25"} for n in (1, 2)]}
        response = self.request(ChitGroupViewSet, "create", "post", payload)
        self.assertEqual(response.status_code, 201, response.data)
        group = ChitGroup.objects.get(pk=response.data["id"])
        self.assertEqual(group.collection_date, date(2026, 9, 25))
        self.assertEqual(group.grand_total, Decimal("200.50"))
        response = self.request(ChitGroupViewSet, "partial_update", "patch", {"name": "Renamed"}, group.pk)
        self.assertEqual(response.status_code, 200, response.data)
        group.refresh_from_db()
        self.assertEqual(group.start_date, date(2026, 9, 23))
        self.assertEqual(list(group.installments.order_by("installment_number").values_list("schedule_value", flat=True)), ["Saved 1", "Saved 2"])
        self.assertEqual(self.request(ChitGroupViewSet, "destroy", "delete", pk=group.pk).status_code, 204)
        self.assertFalse(ChitGroup.objects.filter(pk=group.pk).exists())

    def test_rate_history_and_conflict_do_not_overwrite(self):
        serializer = MortgageSerializer(data={"product_name": "Gold", "unit": "Gram", "current_rate": "5000", "rate_date": "2026-09-23"})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        product = serializer.save()
        for dated, rate in (("2026-09-24", "6000"), ("2026-09-22", "4500")):
            serializer = MortgageSerializer(product, data={"current_rate": rate, "rate_date": dated}, partial=True)
            self.assertTrue(serializer.is_valid(), serializer.errors)
            product = serializer.save()
        self.assertEqual(product.current_rate, Decimal("6000"))
        self.assertEqual(product.rates.count(), 3)
        serializer = MortgageSerializer(product, data={"product_name": "Wrong", "current_rate": "7000", "rate_date": "2026-09-23"}, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        with self.assertRaises(ValidationError):
            serializer.save()
        product.refresh_from_db()
        self.assertEqual(product.product_name, "Gold")
        self.assertEqual(product.rates.get(date="2026-09-23").rate, Decimal("5000"))

    def test_units_saved_and_immediately_listed(self):
        response = self.request(MortgageViewSet, "units", "post", {"name": "Tola"})
        self.assertEqual(response.status_code, 201)
        response = self.request(MortgageViewSet, "units", "get")
        self.assertTrue({"Gram", "No", "Pcs", "Tola"}.issubset(set(response.data)))

    def test_mortgage_edit_keeps_original_rate_and_payments(self):
        customer = self.customer()
        loan_type = LoanType.objects.create(name="Mortgage")
        product = Mortgage.objects.create(product_name="Renamed product", unit="No", current_rate=6000)
        loan = CustomerLoanDetails.objects.create(customer=customer, loan_type=loan_type, loan_start_date=date(2026, 9, 23), loan_amount=1000, paid_amount=25)
        MortgageLoanDetails.objects.create(loan=loan, product=product, product_name="Saved Gold", unit="Gram", quantity=2, current_rate=5000, market_value=10000, loan_amount=1000, interest_percentage=12)
        old = CustomerLoanInstallmentDetails.objects.create(loan=loan, installment_number=1, due_date=date(2026, 9, 24), installment_amount=1000, paid_amount=25, outstanding_amount=975)
        response = self.request(CustomerLoanDetailsViewSet, "update", "put", {"customer_id": customer.id, "mortgage_product_id": product.id, "quantity": 2, "amount": 1000, "interest_percentage": 12, "start_date": "2026-09-23"}, loan.id)
        self.assertEqual(response.status_code, 200, response.data)
        mortgage = MortgageLoanDetails.objects.get(loan=loan)
        self.assertEqual(mortgage.current_rate, Decimal("5000"))
        self.assertEqual(mortgage.market_value, Decimal("10000"))
        self.assertEqual((mortgage.product_name, mortgage.unit), ("Saved Gold", "Gram"))
        old.refresh_from_db()
        loan.refresh_from_db()
        self.assertEqual(old.paid_amount, Decimal("25"))
        self.assertEqual(loan.paid_amount, Decimal("25"))

    def test_holiday_and_collection_type_edit_delete(self):
        for view, payload, change in ((HolidayMasterViewSet, {"holiday_date": "2026-10-01", "holiday_name": "Holiday", "holiday_type": "CUSTOM", "state_region": "Tamil Nadu", "description": "Saved description"}, {"holiday_name": "Renamed"}), (LoanInstallmentViewSet, {"name": "Test cycle", "code": "TEST"}, {"name": "Changed cycle"})):
            response = self.request(view, "create", "post", payload)
            self.assertEqual(response.status_code, 201, response.data)
            pk = response.data["id"]
            response = self.request(view, "partial_update", "patch", change, pk)
            self.assertEqual(response.status_code, 200, response.data)
            for key, value in payload.items():
                self.assertEqual(response.data[key], change.get(key, value))
            self.assertEqual(self.request(view, "destroy", "delete", pk=pk).status_code, 204)
            self.assertEqual(self.request(view, "retrieve", "get", pk=pk).status_code, 404)

    def test_edit_keeps_installment_id_payments_and_collections(self):
        customer = self.customer()
        loan_type = LoanType.objects.create(name="Test loan")
        loan = CustomerLoanDetails.objects.create(customer=customer, loan_type=loan_type, loan_start_date=date(2026, 9, 23), paid_amount=25)
        old = CustomerLoanInstallmentDetails.objects.create(loan=loan, installment_number=1, due_date=date(2026, 9, 24), installment_amount=100, paid_amount=25, outstanding_amount=75)
        receipt = CollectionTransaction.objects.create(loan=loan, customer=customer, installment=old, collection_amount=25, collection_date=date(2026, 9, 24))
        new = CustomerLoanInstallmentDetails(loan=loan, installment_number=1, due_date=date(2026, 9, 25), installment_amount=Decimal("120"))
        saved = save_installments_preserving_payments(loan, [new])[0]
        self.assertEqual(saved.pk, old.pk)
        self.assertEqual(saved.paid_amount, Decimal("25"))
        self.assertEqual(saved.outstanding_amount, Decimal("95"))
        receipt.refresh_from_db()
        self.assertEqual(receipt.installment_id, old.pk)
        with self.assertRaises(ValidationError):
            save_installments_preserving_payments(loan, [])
        self.assertTrue(CustomerLoanInstallmentDetails.objects.filter(pk=old.pk).exists())
        self.assertEqual(self.request(CustomerViewSet, "destroy", "delete", pk=customer.pk).status_code, 409)
