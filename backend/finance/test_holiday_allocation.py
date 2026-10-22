from datetime import date
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient
from .models import HolidayMaster, LoanHolidaySettings

class HolidayAllocationTests(TestCase):
    def test_invalid_loan_does_not_allocate(self):
        client = APIClient()
        client.force_authenticate(User.objects.create_user('allocation-admin', is_staff=True))
        holiday = HolidayMaster.objects.create(holiday_date=date(2026,10,12), holiday_name='Local', holiday_type='LOCAL')
        response = client.post(f'/api/finance/holidays/{holiday.pk}/allocate/', {'loan_id': 999999}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(LoanHolidaySettings.objects.exists())

from .test_holiday_calendar import HolidayCalendarScheduleTests
from .models import CustomerLoanDetails, Ledger

class ScheduledAllocationTests(HolidayCalendarScheduleTests):
    def test_allocate_persists_without_rescheduling_and_is_idempotent(self):
        loan_id = self.chit()
        loan = CustomerLoanDetails.objects.get(pk=loan_id)
        before = list(loan.installment_details.values_list('due_date', 'installment_amount'))
        holiday = self.holiday(date(2026, 1, 10))
        url = f'/api/finance/holidays/{holiday.pk}/allocate/'
        first = self.client.post(url, {'loan_id': loan_id}, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        again = self.client.post(url, {'loan_id': loan_id}, format='json')
        self.assertEqual(again.status_code, 200)
        self.assertEqual(first.data['id'], again.data['id'])
        self.assertEqual(LoanHolidaySettings.objects.filter(loan=loan, holiday=holiday).count(), 1)
        self.assertEqual(list(loan.installment_details.values_list('due_date', 'installment_amount')), before)
        saved = self.client.get(f'/api/finance/holidays/{holiday.pk}/').data
        self.assertEqual(saved['allocations'][0]['loan_id'], loan_id)
        self.assertEqual(self.client.get(f'/api/finance/holidays/{holiday.pk}/allocations/').data[0]['allocation_id'], first.data['id'])

    def test_all_groups_payment_save_edit_reopen_and_collection_relationship(self):
        account = Ledger.objects.create(name='Cash', group='Cash-in-Hand')
        loan_id = self.chit()
        loan = CustomerLoanDetails.objects.get(pk=loan_id)
        row = loan.installment_details.first()
        # Cash in Hand / Bank Accounts belong to Accounts only, never the Ledger side.
        bank_ledger = Ledger.objects.create(name='Ledger Bank Accounts', group='Bank Accounts')
        self.assertEqual(self.client.post('/api/finance/payment-entries/', {'ledger': bank_ledger.pk, 'account': account.pk, 'amount': '10', 'payment_mode': 'Cash', 'date': '2026-01-10'}, format='json').status_code, 400)
        for group in ('Fixed Assets', 'Income', 'Capital Account'):
            ledger = Ledger.objects.create(name=f'Ledger {group}', group=group)
            self.assertIn(ledger.pk, [item['id'] for item in self.client.get('/api/finance/ledgers/').data])
            result = self.client.post('/api/finance/payment-entries/', {'ledger': ledger.pk, 'ledger_group': group, 'account': account.pk, 'amount': '10', 'payment_mode': 'Cash', 'date': '2026-01-10'}, format='json')
            self.assertEqual(result.status_code, 201, result.data)
            url = f"/api/finance/payment-entries/{result.data['id']}/"
            self.assertEqual(self.client.patch(url, {'ledger': ledger.pk, 'ledger_group': group, 'amount': '12'}, format='json').status_code, 200)
            self.assertEqual(self.client.get(url).data['ledger'], ledger.pk)
        collection = self.client.post(f'/api/finance/customer-loan-installments/{row.pk}/collect/', {'customer_paid_amount': '10', 'payment_date': '2026-01-10', 'payment_mode': 'Cash', 'account_id': account.pk, 'party_ledger_id': ledger.pk, 'ledger_id': ledger.pk, 'ledger_amount': '0'}, format='json')
        self.assertEqual(collection.status_code, 200, collection.data)
        url = f"/api/finance/collection-transactions/{collection.data['collection_id']}/"
        saved = self.client.get(url).data
        self.assertEqual((saved['party_ledger'], saved['customer'], saved['loan']), (ledger.pk, self.customer.pk, loan_id))
        edited = self.client.patch(url, {'party_ledger': ledger.pk, 'ledger': ledger.pk, 'ledger_group': ledger.group}, format='json')
        self.assertEqual(edited.status_code, 200, edited.data)
