from datetime import date
from decimal import Decimal
from unittest.mock import patch
from django.test import TestCase
from . import test_collection_receipt as fixtures
from .models import ChitGroupInstallmentDetail, CollectionTransaction

class FuturePendingTests(TestCase):
    setUp=fixtures.CollectionReceiptTests.setUp
    loan=fixtures.CollectionReceiptTests.loan

    @patch('finance.views.timezone.localdate', return_value=date(2026,10,15))
    def test_prepaid_future_due_remains_pending_and_subsequent_payments_reduce_it(self, _):
        self.group.duration=1
        self.group.save()
        ChitGroupInstallmentDetail.objects.filter(group=self.group).delete()
        ChitGroupInstallmentDetail.objects.create(group=self.group,installment_number=1,schedule_value='1',installment_amount='5000')
        loan=self.loan('Chit',start_date='2026-11-05')
        due=loan['installments'][0]
        url=f"/api/finance/customer-loan-installments/{due['id']}/collect/"
        for received, expected in [('1000','4000'),('500','3500'),('3500','0')]:
            result=self.client.post(url,{'payment_date':'2026-10-15','customer_paid_amount':received,'allocations':[{'installment_id':due['id'],'amount':received}]},format='json')
            self.assertEqual(result.status_code,200,result.data)
            report=self.client.get('/api/finance/reports/day-wise/',{'customer_id':self.customer.pk,'to':'2026-11-05'}).data
            if expected == '0':
                self.assertEqual(report['results'],[])
            else:
                self.assertEqual(Decimal(str(report['results'][0]['balance'])),Decimal(expected))
        self.assertEqual(CollectionTransaction.objects.filter(loan_id=loan['id']).count(),3)
        self.assertEqual(self.client.get('/api/finance/reports/day-wise/',{'customer_id':self.customer.pk,'to':'2026-10-15'}).data['results'],[])
