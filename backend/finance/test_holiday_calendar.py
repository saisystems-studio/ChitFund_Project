from datetime import date

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from customers.models import Customer
from .models import ChitGroup, ChitGroupInstallmentDetail, CustomerLoanDetails, HolidayMaster, LoanInstallment, LoanType

SATURDAY = date(2026, 1, 10)  # Sunday 11th, Monday 12th, Tuesday 13th


class HolidayCalendarScheduleTests(TestCase):
    """Saved Holiday Calendar drives new installment dates: holidays and unticked Sundays are
    Off; a Sunday ticked Working (SUNDAY_WORKING) is a collection day. Amounts never change."""

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('holiday-admin', is_staff=True))
        self.customer = Customer.objects.create(customer_code='HC001', full_name='Ravi', primary_mobile='9876500500', role='BORROWER')
        self.types = {name: LoanType.objects.get_or_create(name=name)[0] for name in ('Chit', 'Interest', 'Mortgage')}
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='HC', name='Holiday Calendar', duration=3, duration_type='DAY')
        for number in (1, 2, 3):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=number, schedule_value=str(number), installment_amount=100)

    def holiday(self, day, kind='GOVERNMENT', name='Holiday'):
        return HolidayMaster.objects.create(holiday_date=day, holiday_name=name, holiday_type=kind)

    def due_dates(self, loan_id):
        return [row.due_date.day for row in CustomerLoanDetails.objects.get(pk=loan_id).installment_details.order_by('installment_number')]

    def chit(self, **extra):
        response = self.client.post('/api/finance/loans/', {'customer_id': self.customer.pk, 'loan_type_id': self.types['Chit'].pk, 'chit_group_id': self.group.pk, 'amount': '300', 'start_date': SATURDAY.isoformat(), **extra}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['id']

    def interest(self, **extra):
        response = self.client.post('/api/finance/loans/', {'customer_id': self.customer.pk, 'loan_type_id': self.types['Interest'].pk, 'amount': '300', 'interest_percentage': '10', 'periodicity': 'Daily', 'interest_duration': 3, 'interest_duration_type': 'DAY', 'start_date': SATURDAY.isoformat(), **extra}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['id']

    def preview(self, **extra):
        response = self.client.post('/api/finance/chit-loans/preview-schedule/', {'chit_group_id': self.group.pk, 'start_date': SATURDAY.isoformat(), 'include_sunday': False, 'blocked_holidays': [], **extra}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        return [date.fromisoformat(str(row['due_date'])).day for row in response.data['installments']]

    def test_chit_unticked_sunday_is_off_and_ticked_sunday_is_working(self):
        self.assertEqual(self.due_dates(self.chit()), [10, 12, 13])
        self.assertEqual(self.preview(), [10, 12, 13])
        self.holiday(date(2026, 1, 11), 'SUNDAY_WORKING', 'Sunday Working')
        self.assertEqual(self.due_dates(self.chit()), [10, 11, 12])
        self.assertEqual(self.preview(), [10, 11, 12])

    def test_chit_holidays_are_skipped_unless_the_loan_includes_them(self):
        monday = self.holiday(date(2026, 1, 12), 'LOCAL', 'Local Festival')
        self.assertEqual(self.due_dates(self.chit()), [10, 13, 14])
        self.assertEqual(self.preview(), [10, 13, 14])
        self.assertEqual(self.preview(selected_holidays=[monday.pk]), [10, 12, 13])
        self.assertEqual(self.due_dates(self.chit(selected_holidays=[monday.pk])), [10, 12, 13])

    def test_sunday_collection_toggle_still_keeps_every_sunday_open(self):
        self.assertEqual(self.due_dates(self.chit(include_sunday=True)), [10, 11, 12])

    def test_interest_follows_the_calendar_and_keeps_amounts(self):
        loan_id = self.interest()
        self.assertEqual(self.due_dates(loan_id), [10, 12, 13])
        self.assertEqual([str(row.installment_amount) for row in CustomerLoanDetails.objects.get(pk=loan_id).installment_details.order_by('installment_number')], ['110.00', '110.00', '110.00'])
        self.holiday(date(2026, 1, 11), 'SUNDAY_WORKING', 'Sunday Working')
        self.holiday(date(2026, 1, 12), 'GOVERNMENT', 'Festival')
        self.assertEqual(self.due_dates(self.interest()), [10, 11, 13])

    def test_mortgage_due_date_moves_off_an_off_sunday(self):
        payload = {'customer_id': self.customer.pk, 'loan_type_id': self.types['Mortgage'].pk, 'amount': '1000', 'interest_percentage': '12', 'start_date': SATURDAY.isoformat()}
        first = self.client.post('/api/finance/loans/', payload, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(self.due_dates(first.data['id']), [12])
        self.holiday(date(2026, 1, 11), 'SUNDAY_WORKING', 'Sunday Working')
        second = self.client.post('/api/finance/loans/', payload, format='json')
        self.assertEqual(self.due_dates(second.data['id']), [11])

    def test_saved_schedules_are_not_changed_by_later_calendar_edits(self):
        loan_id = self.chit()
        self.holiday(date(2026, 1, 11), 'SUNDAY_WORKING', 'Sunday Working')
        self.assertEqual(self.due_dates(loan_id), [10, 12, 13])


class HolidayApiValidationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('holiday-api-admin', is_staff=True))

    def post(self, **data):
        return self.client.post('/api/finance/holidays/', {'holiday_date': '2026-01-12', 'holiday_name': 'Festival', 'holiday_type': 'GOVERNMENT', **data}, format='json')

    def test_types_reasons_and_working_sundays_are_validated(self):
        self.assertEqual(self.post(holiday_type='unknown').status_code, 400)
        self.assertEqual(self.post(holiday_name='  ').status_code, 400)
        self.assertEqual(self.post(holiday_type='SUNDAY_WORKING').status_code, 400)  # 12th is a Monday
        self.assertEqual(self.post(holiday_date='2026-01-11', holiday_type='SUNDAY_WORKING', holiday_name='Sunday Working').status_code, 201)
        created = self.post(holiday_type='local')
        self.assertEqual((created.status_code, created.data['holiday_type']), (201, 'LOCAL'))
        self.assertEqual(self.post().status_code, 400)  # one record per date
