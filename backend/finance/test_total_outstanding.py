from django.test import TestCase
from decimal import Decimal
from . import test_collection_receipt as fixtures
from .models import ChitGroupInstallmentDetail
class TotalOutstandingTests(TestCase):
 setUp=fixtures.CollectionReceiptTests.setUp
 loan=fixtures.CollectionReceiptTests.loan
 def test_total_includes_future_due_with_only_cutoff_allocations(self):
  self.group.duration=1;self.group.save()
  ChitGroupInstallmentDetail.objects.filter(group=self.group).delete()
  ChitGroupInstallmentDetail.objects.create(group=self.group,installment_number=1,schedule_value='1',installment_amount=5000)
  loan=self.loan('Chit',start_date='2026-11-05');due=loan['installments'][0]
  result=self.client.post(f"/api/finance/customer-loan-installments/{due['id']}/collect/",{'payment_date':'2026-10-15','customer_paid_amount':'1000','allocations':[{'installment_id':due['id'],'amount':'1000'}]},format='json')
  self.assertEqual(result.status_code,200,result.data)
  def report(cutoff):return self.client.get('/api/finance/reports/loan-wise/',{'scope':'total','customer_id':self.customer.pk,'to':cutoff}).data
  row=report('2026-10-15')['results'][0]
  self.assertEqual((row['total_payable'],row['paid'],row['outstanding']),(Decimal('5000'),Decimal('1000'),Decimal('4000')))
  self.assertEqual(row['installments'][0]['balance'],Decimal('4000'))
  self.assertEqual(row['installments'][0]['collections'][0]['date'].isoformat(),'2026-10-15')
  all_pending=self.client.get('/api/finance/reports/day-wise/',{'scope':'all_pending','to':'2026-10-15'}).data['results']
  self.assertEqual(all_pending[0]['balance'],Decimal('4000'))
  self.assertEqual(all_pending[0]['days_overdue'],0)
  self.assertEqual(row['overdue'],0)
  self.assertEqual(row['unallocated_others'],0)
  self.assertEqual(report('2026-10-14')['results'][0]['outstanding'],Decimal('5000'))
  self.assertEqual(self.client.get('/api/finance/reports/day-wise/',{'to':'2026-10-15'}).data['results'],[])

 def test_advance_is_separate_from_allocated_collections(self):
  loan=self.loan('Chit',start_date='2026-11-05');dues=loan['installments']
  response=self.client.post(f"/api/finance/customer-loan-installments/{dues[0]['id']}/collect/",{'payment_date':'2026-10-15','customer_paid_amount':'6000','advance_amount':'1000','allocations':[{'installment_id':row['id'],'amount':'2500'} for row in dues]},format='json')
  self.assertEqual(response.status_code,200,response.data)
  report=self.client.get('/api/finance/reports/loan-wise/',{'scope':'total','customer_id':self.customer.pk,'to':'2026-10-15'}).data
  row=report['results'][0]
  self.assertEqual((row['paid'],row['outstanding'],row['unallocated_others']),(Decimal('5000'),0,Decimal('1000')))
  before=self.client.get('/api/finance/reports/loan-wise/',{'scope':'total','customer_id':self.customer.pk,'to':'2026-10-14'}).data['results'][0]
  self.assertEqual((before['paid'],before['outstanding'],before['unallocated_others']),(0,Decimal('5000'),0))
