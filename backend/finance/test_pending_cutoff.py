from datetime import date
from decimal import Decimal
from unittest.mock import patch
from django.test import TestCase
from . import test_collection_receipt as fixtures
from .models import CustomerLoanInstallmentDetails

class PendingCutoffTests(TestCase):
 setUp=fixtures.CollectionReceiptTests.setUp
 loan=fixtures.CollectionReceiptTests.loan
 @patch('finance.views.timezone.localdate',return_value=date(2026,10,15))
 def test_cutoff_and_historical_allocations(self,_):
  loan=self.loan('Chit',start_date='2026-10-14')
  first,second=loan['installments']
  for row,on in [(first,'2026-10-14'),(second,'2026-10-15')]:
   CustomerLoanInstallmentDetails.objects.filter(pk=row['id']).update(due_date=on)
  for on,value in [('2026-10-15','1000'),('2026-10-20','1500')]:
   result=self.client.post(f"/api/finance/customer-loan-installments/{first['id']}/collect/",{'payment_date':on,'customer_paid_amount':value,'allocations':[{'installment_id':first['id'],'amount':value}]},format='json')
   self.assertEqual(result.status_code,200,result.data)
  endpoint='/api/finance/reports/day-wise/'
  rows=self.client.get(endpoint).data['results']
  self.assertEqual([Decimal(str(r['balance'])) for r in rows],[Decimal('1500'),Decimal('2500')])
  self.assertEqual([r['days_overdue'] for r in rows],[1,0])
  CustomerLoanInstallmentDetails.objects.filter(pk=second['id']).update(due_date='2026-10-16')
  self.assertEqual(len(self.client.get(endpoint).data['results']),1)
  CustomerLoanInstallmentDetails.objects.filter(pk=second['id']).update(due_date='2026-10-15')
  self.assertEqual(len(self.client.get(endpoint,{'to':'2026-10-14'}).data['results']),1)
  self.assertEqual(Decimal(str(self.client.get(endpoint,{'to':'2026-10-14'}).data['results'][0]['balance'])),Decimal('2500'))
  self.assertEqual(len(self.client.get(endpoint,{'to':'2026-10-20'}).data['results']),1)
  CustomerLoanInstallmentDetails.objects.filter(pk=second['id']).update(due_date='2026-11-05',installment_amount=5000)
  self.assertEqual(len(self.client.get(endpoint).data['results']),1)
  rows=self.client.get(endpoint,{'to':'2026-11-05'}).data['results']
  self.assertEqual(len(rows),1)
  self.assertEqual(Decimal(str(rows[0]['balance'])),Decimal('5000'))
