from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from customers.models import Customer
from .models import ChitGroup, ChitGroupInstallmentDetail, CollectionAllocation, CollectionTransaction, LoanInstallment, LoanType


class CollectionReceiptTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(User.objects.create_user('receipt-admin', is_staff=True))
        self.customer = Customer.objects.create(customer_code='RCP001', full_name='Receipt Customer', primary_mobile='9876500003', role='BORROWER',
                                                address='12 Main Road', district='Chennai', state='Tamil Nadu', pincode='600001')
        self.types = {name: LoanType.objects.get_or_create(name=name)[0] for name in ('Chit', 'Interest', 'Mortgage')}
        LoanInstallment.objects.get_or_create(name='Daily', defaults={'code': 'DAILY'})
        self.group = ChitGroup.objects.create(code='RCP', name='Receipt Group', duration=2, duration_type='DAY')
        for number in (1, 2):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=number, schedule_value=str(number), installment_amount=2500)

    def loan(self, kind, customer=None, **extra):
        payload = {'customer_id': (customer or self.customer).pk, 'loan_type_id': self.types[kind].pk, 'amount': '5000',
                   'start_date': timezone.localdate().isoformat(), 'chit_group_id': self.group.pk, 'include_sunday': True,
                   'interest_percentage': '10', 'periodicity': 'Daily', 'interest_duration': 2, **extra}
        response = self.client.post('/api/finance/loans/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def collect(self, loan, amount):
        response = self.client.post(f"/api/finance/customer-loan-installments/{loan['installments'][0]['id']}/collect/",
                                    {'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': amount, 'notes': 'Paid at office'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        return CollectionTransaction.objects.filter(loan_id=loan['id']).latest('id')

    def receipt(self, *collections):
        return self.client.get('/api/finance/collections/receipt/', {'ids': ",".join(str(item.pk) for item in collections)})

    def test_each_paid_installment_is_a_row(self):
        collection = self.collect(self.loan('Chit'), '5000')
        self.assertEqual(CollectionAllocation.objects.filter(transaction=collection).count(), 2)
        response = self.receipt(collection)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['customer']['address'], ['12 Main Road', 'Chennai, Tamil Nadu - 600001'])
        [section] = response.data['sections']
        self.assertEqual((section['loan_type'], section['voucher_no'], section['notes'], section['total']), ('CHIT', f'RV-{collection.pk:06d}', 'Paid at office', Decimal('5000.00')))
        self.assertEqual([row['amount'] for row in section['rows']], [Decimal('2500.00'), Decimal('2500.00')])
        self.assertIn('Receipt Group', section['rows'][0]['particulars'])
        self.assertIn('Installment #1', section['rows'][0]['particulars'])
        self.assertIn('Installment #2', section['rows'][1]['particulars'])

    def test_older_collections_without_a_stored_split_are_rebuilt_oldest_first(self):
        loan = self.loan('Chit')
        first, second = self.collect(loan, '3000'), self.collect(loan, '2000')
        CollectionAllocation.objects.all().delete()  # as saved before splits were recorded
        rows = lambda item: [(row['particulars'].rsplit('— ', 1)[1].split(' (')[0], row['amount']) for row in self.receipt(item).data['sections'][0]['rows']]
        self.assertEqual(rows(first), [('Installment #1', Decimal('2500.00')), ('Installment #2', Decimal('500.00'))])
        self.assertEqual(rows(second), [('Installment #2', Decimal('2000.00'))])

    def test_loan_types_are_never_mixed(self):
        chit, interest = self.collect(self.loan('Chit'), '2500'), self.collect(self.loan('Interest'), '100')
        sections = self.receipt(chit, interest).data['sections']
        self.assertEqual([section['loan_type'] for section in sections], ['CHIT', 'INTEREST'])
        self.assertTrue(all(row['particulars'].startswith('Chit') for row in sections[0]['rows']))
        self.assertTrue(all(row['particulars'].startswith('Interest Loan') for row in sections[1]['rows']))

    def test_single_installment_collection_path_records_its_split(self):
        loan = self.loan('Chit')
        response = self.client.post('/api/finance/collections/create/', {'installment_id': loan['installments'][1]['id'], 'collection_amount': '700'}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        [row] = self.receipt(CollectionTransaction.objects.get(loan_id=loan['id'])).data['sections'][0]['rows']
        self.assertEqual(row['amount'], Decimal('700.00')); self.assertIn('Installment #2', row['particulars'])

    def test_invalid_requests(self):
        other = Customer.objects.create(customer_code='RCP002', full_name='Other', primary_mobile='9876500004', role='BORROWER')
        mine, theirs = self.collect(self.loan('Chit'), '100'), self.collect(self.loan('Chit', customer=other), '100')
        self.assertEqual(self.receipt(mine, theirs).status_code, 400)
        self.assertEqual(self.client.get('/api/finance/collections/receipt/', {'ids': '999999'}).status_code, 404)
        self.assertEqual(self.client.get('/api/finance/collections/receipt/', {'ids': 'x'}).status_code, 400)
