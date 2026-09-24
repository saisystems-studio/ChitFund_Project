from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer
from .models import ChitGroup, ChitGroupInstallmentDetail, LoanInstallment, LoanType


class CustomerWiseReportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('report-admin', is_staff=True))
        self.kumar = Customer.objects.create(customer_code='CWR001', full_name='Kumar',
                                             primary_mobile='9876500001', role='BORROWER')
        self.ravi = Customer.objects.create(customer_code='CWR002', full_name='Ravi',
                                            primary_mobile='9876500002', role='BORROWER')
        self.types = {name: LoanType.objects.get_or_create(name=name)[0] for name in ('Chit', 'Interest', 'Mortgage')}
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='CWR', name='Report Group', duration=2, duration_type='DAY')
        for number in (1, 2):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=number,
                                                     schedule_value=str(number), installment_amount=50)

    def loan(self, customer, kind):
        payload = {'customer_id': customer.pk, 'loan_type_id': self.types[kind].pk, 'amount': '100',
                   'start_date': timezone.localdate().isoformat(), 'interest_percentage': '10',
                   'periodicity': 'Daily', 'interest_duration': 2, 'chit_group_id': self.group.pk,
                   'include_sunday': True}
        response = self.client.post('/api/finance/loans/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def report(self, **params):
        response = self.client.get('/api/finance/reports/customer-wise/', params)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_lists_all_customers_and_groups_loans_by_customer(self):
        self.loan(self.kumar, 'Chit')
        self.loan(self.kumar, 'Interest')
        data = self.report()
        self.assertEqual({row['name'] for row in data['customers']}, {'Kumar', 'Ravi'})
        self.assertEqual(len(data['results']), 1)
        loans = data['results'][0]['loans']
        self.assertEqual({loan['loan_type'] for loan in loans}, {'Chit', 'Interest'})
        chit = next(loan for loan in loans if loan['loan_type'] == 'Chit')
        self.assertEqual(chit['chit']['group_name'], 'Report Group')
        self.assertEqual(chit['total_installments'], len(chit['schedule']))
        self.assertEqual(chit['pending_installments'], chit['total_installments'] - chit['paid_installments'])

    def test_filters_by_customer_loan_type_and_status(self):
        self.loan(self.kumar, 'Chit')
        self.loan(self.kumar, 'Interest')
        self.loan(self.ravi, 'Chit')
        data = self.report(customer=self.kumar.pk, loan_type='Chit')
        self.assertEqual([row['customer']['name'] for row in data['results']], ['Kumar'])
        self.assertEqual([loan['loan_type'] for loan in data['results'][0]['loans']], ['Chit'])
        self.assertEqual(self.report(status='Completed')['results'], [])
        self.assertEqual(self.report(**{'from': '2000-01-01', 'to': '2000-01-31'})['results'], [])

    def test_rejects_invalid_dates(self):
        response = self.client.get('/api/finance/reports/customer-wise/', {'from': 'bad'})
        self.assertEqual(response.status_code, 400)
