from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import UserProfile
from customers.models import Customer
from .models import ChitGroup, ChitGroupInstallmentDetail, Ledger, LoanInstallment, LoanType, PaymentEntry


class ReportRecordAdminPermissionTests(TestCase):
    """Records reached from the Reports (loans, receipts, payments) can be viewed by every
    signed-in user, but only administrators may edit or delete them."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user('report-admin', is_staff=True)
        self.writer = User.objects.create_user('report-writer')
        UserProfile.objects.create(user=self.writer, can_write=True)
        self.viewer = User.objects.create_user('report-viewer')
        self.client.force_authenticate(self.admin)
        customer = Customer.objects.create(customer_code='RP001', full_name='Meena', primary_mobile='9876500600', role='BORROWER')
        chit = LoanType.objects.get_or_create(name='Chit')[0]
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        group = ChitGroup.objects.create(code='RP', name='Report Perms', duration=2, duration_type='DAY')
        for number in (1, 2):
            ChitGroupInstallmentDetail.objects.create(group=group, installment_number=number, schedule_value=str(number), installment_amount=50)
        today = timezone.localdate().isoformat()
        self.loan = self.client.post('/api/finance/loans/', {'customer_id': customer.pk, 'loan_type_id': chit.pk, 'chit_group_id': group.pk, 'amount': '100', 'start_date': today, 'include_sunday': True}, format='json').data
        bank = Ledger.objects.create(name='HDFC Bank', group='Bank Accounts')
        self.payment = PaymentEntry.objects.create(ledger_group='Sundry Creditors', account=bank, amount='75.00', payment_mode='UPI', transaction_utr='U1', date=today)

    def urls(self):
        return [f"/api/finance/loans/{self.loan['id']}/", f'/api/finance/payment-entries/{self.payment.pk}/']

    def test_everyone_can_view_reports_and_records(self):
        for user in (self.viewer, self.writer, self.admin):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get('/api/finance/reports/today/').status_code, 200)
            for url in self.urls():
                self.assertEqual(self.client.get(url).status_code, 200, (user.username, url))

    def test_only_admins_can_edit_or_delete(self):
        for user in (self.viewer, self.writer):
            self.client.force_authenticate(user)
            for url in self.urls():
                self.assertEqual(self.client.patch(url, {'notes': 'changed'}, format='json').status_code, 403, (user.username, url))
                self.assertEqual(self.client.delete(url).status_code, 403, (user.username, url))
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch(self.urls()[1], {'notes': 'changed by admin'}, format='json').status_code, 200)
        self.assertEqual(self.client.delete(self.urls()[1]).status_code, 204)

    def test_today_report_rows_carry_party_voucher_and_payment_mode(self):
        rows = {row['transaction_type']: row for row in self.client.get('/api/finance/reports/today/').data['rows']}
        self.assertEqual((rows['Loan']['party'], rows['Loan']['payment_mode']), ('Meena', ''))
        # A payment without a ledger shows its ledger group as the party.
        self.assertEqual((rows['Payment']['party'], rows['Payment']['payment_mode'], rows['Payment']['voucher_no']), ('Sundry Creditors', 'UPI', f'PV-{self.payment.pk:06d}'))
