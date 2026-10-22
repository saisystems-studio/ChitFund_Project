from decimal import Decimal
from django.test import TestCase
from django.utils import timezone
from .test_collection_receipt import CollectionReceiptTests
from .models import CollectionTransaction, CollectionAllocation

class FifoCollectionTests(TestCase):
    setUp = CollectionReceiptTests.setUp
    loan = CollectionReceiptTests.loan

    def test_fifo_one_receipt_balances_and_retry(self):
        loan = self.loan('Chit')
        ids = [r['id'] for r in loan['installments']]
        payload = {'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': '3000',
                   'allocations': [{'installment_id': ids[0], 'amount': '2500'}, {'installment_id': ids[1], 'amount': '500'}],
                   'request_key': 'fifo-retry-example'}
        url = f"/api/finance/customer-loan-installments/{ids[0]}/collect/"
        first = self.client.post(url, payload, format='json')
        self.assertEqual(first.status_code, 200, first.data)
        retry = self.client.post(url, payload, format='json')
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(first.data['collection_id'], retry.data['collection_id'])
        self.assertEqual(CollectionTransaction.objects.count(), 1)
        self.assertEqual(CollectionAllocation.objects.count(), 2)
        detail = self.client.get(f"/api/finance/loans/{loan['id']}/").data
        self.assertEqual([Decimal(str(r['balance'])) for r in detail['installments']], [Decimal('0'), Decimal('2000')])

    def test_explicit_advance_uses_one_receipt_without_overpaying_dues(self):
        loan = self.loan('Chit')
        ids = [r['id'] for r in loan['installments']]
        response = self.client.post(f"/api/finance/customer-loan-installments/{ids[0]}/collect/", {
            'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': '6000', 'advance_amount': '1000',
            'allocations': [{'installment_id': key, 'amount': '2500'} for key in ids],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        receipt = CollectionTransaction.objects.get()
        self.assertEqual(receipt.collection_amount, Decimal('6000'))
        self.assertEqual(receipt.advance_amount, Decimal('1000'))
        detail = self.client.get(f"/api/finance/loans/{loan['id']}/").data
        self.assertTrue(all(Decimal(str(r['balance'])) == 0 for r in detail['installments']))
        receipt_data = self.client.get('/api/finance/collections/receipt/', {'ids': receipt.pk}).data
        self.assertEqual(receipt_data['sections'][0]['total'], Decimal('6000'))

    def test_example_leaves_only_fifth_due_and_balanced_posting(self):
        from .models import ChitGroupInstallmentDetail
        from .accounting_reports import trial_balance
        self.group.duration = 5
        self.group.save()
        ChitGroupInstallmentDetail.objects.filter(group=self.group).delete()
        amounts = ['3000', '3000', '2000', '1000', '6000']
        for i, value in enumerate(amounts, 1):
            ChitGroupInstallmentDetail.objects.create(group=self.group, installment_number=i, schedule_value=str(i), installment_amount=value)
        loan = self.loan('Chit')
        rows = loan['installments']
        before = trial_balance()
        split = ['3000', '3000', '2000', '1000', '1000']
        response = self.client.post(f"/api/finance/customer-loan-installments/{rows[0]['id']}/collect/", {
            'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': '10000',
            'allocations': [{'installment_id': row['id'], 'amount': value} for row, value in zip(rows, split)]
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        detail = self.client.get(f"/api/finance/loans/{loan['id']}/").data
        self.assertEqual([Decimal(str(r['balance'])) for r in detail['installments']], [Decimal('0')]*4+[Decimal('5000')])
        self.assertEqual(CollectionTransaction.objects.count(), 1)
        self.assertEqual(CollectionAllocation.objects.count(), 5)
        after = trial_balance()
        self.assertEqual(after['total_debit'] - after['total_credit'], before['total_debit'] - before['total_credit'])

    def test_retry_with_changed_split_is_rejected(self):
        loan = self.loan('Chit')
        key = loan['installments'][0]['id']
        url = f"/api/finance/customer-loan-installments/{key}/collect/"
        payload = {'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': '100',
                   'allocations': [{'installment_id': key, 'amount': '100'}], 'request_key': 'stable-key'}
        self.assertEqual(self.client.post(url, payload, format='json').status_code, 200)
        payload['customer_paid_amount'] = '200'
        payload['allocations'][0]['amount'] = '200'
        self.assertEqual(self.client.post(url, payload, format='json').status_code, 409)
        self.assertEqual(CollectionTransaction.objects.count(), 1)

    def test_advance_receipt_edit_and_delete_preserve_due_history(self):
        loan = self.loan('Chit')
        ids = [r['id'] for r in loan['installments']]
        response = self.client.post(f"/api/finance/customer-loan-installments/{ids[0]}/collect/", {
            'payment_date': timezone.localdate().isoformat(), 'customer_paid_amount': '6000', 'advance_amount': '1000',
            'allocations': [{'installment_id': key, 'amount': '2500'} for key in ids],
        }, format='json')
        self.assertEqual(response.status_code, 200)
        receipt = CollectionTransaction.objects.get()
        url = f'/api/finance/collection-transactions/{receipt.pk}/'
        response = self.client.patch(url, {'remarks': 'FIFO advance'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(sum(receipt.allocations.values_list('amount', flat=True)), Decimal('5000'))
        self.assertEqual(self.client.delete(url).status_code, 204)
        detail = self.client.get(f"/api/finance/loans/{loan['id']}/").data
        self.assertEqual([Decimal(str(r['balance'])) for r in detail['installments']], [Decimal('2500'), Decimal('2500')])
