from datetime import date
from types import SimpleNamespace

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from .models import ChitGroup
from .views import preview_chit_schedule


class PreviewScheduleTests(TestCase):
    def preview(self, payload):
        request = APIRequestFactory().post("/finance/chit-loans/preview-schedule/", payload, format="json")
        force_authenticate(request, user=SimpleNamespace(is_authenticated=True, is_staff=True, is_superuser=True))
        return preview_chit_schedule(request)

    def test_monthly_without_end_date(self):
        response = self.preview({"start_date": "2026-09-01", "duration": 3,
                                 "duration_type": "MONTH", "collection_day": 5,
                                 "end_date": None, "include_sunday": True})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["due_date"] for row in response.data["installments"]],
                         [date(2026, 9, 5), date(2026, 10, 5), date(2026, 11, 5)])

    def test_yearly_and_holiday_shift(self):
        response = self.preview({"start_date": "2026-09-01", "duration": 2,
                                 "duration_type": "YEAR", "collection_day": 23,
                                 "collection_month": 9, "end_date": "",
                                 "blocked_holidays": ["2026-09-23"], "include_sunday": True})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["installments"][0]["due_date"], date(2026, 9, 24))
        self.assertEqual(response.data["loan_end_date"], date(2027, 9, 23))

    def test_selected_group_supplies_start_and_duration(self):
        group = ChitGroup.objects.create(code="PREVIEW", name="Preview", start_date=date(2026, 9, 1),
                                        duration=2, duration_type="MONTH", collection_day=10)
        response = self.preview({"chit_group_id": group.pk, "end_date": None, "include_sunday": True})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["installments"]), 2)
        self.assertEqual(response.data["loan_end_date"], date(2026, 10, 10))

    def test_date_aliases_and_daily_sunday_rule(self):
        for key in ("start_date", "loan_start_date", "chit_start_date"):
            with self.subTest(key=key):
                response = self.preview({key: "2026-09-06", "duration": 1, "duration_type": "DAY"})
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data["loan_end_date"], date(2026, 9, 7))

    def test_invalid_dates_return_400(self):
        for value in ("09/01/2026", "2026-02-30", "", "20260901"):
            response = self.preview({"start_date": value, "duration": 1, "duration_type": "DAY"})
            self.assertEqual(response.status_code, 400)
