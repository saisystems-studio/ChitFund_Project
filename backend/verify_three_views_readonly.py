import os,json
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django;django.setup()
from decimal import Decimal
from django.contrib.auth.models import User
from finance.models import CustomerLoanInstallmentDetails,CollectionAllocation,CollectionTransaction
from finance.views import loan_wise_report,day_wise_report,today_report
from finance.party_collection import ledger_outstanding
from finance.models import Ledger
from rest_framework.test import APIRequestFactory,force_authenticate
f=APIRequestFactory();user=User.objects.filter(is_staff=True).first()
def read(view,params):
 r=f.get('/verify/',params);force_authenticate(r,user=user);response=view(r);assert response.status_code==200,response.data;return response.data
row=CustomerLoanInstallmentDetails.objects.get(pk=2)
allocated=sum(CollectionAllocation.objects.filter(installment=row,transaction__collection_date__lte='2026-10-15').values_list('amount',flat=True),Decimal('0'))
assert row.installment_amount==Decimal('5000') and allocated==Decimal('1000') and row.installment_amount-allocated==Decimal('4000')
total=read(loan_wise_report,{'scope':'total','customer_id':2,'to':'2026-10-15'})
assert total['results'][0]['outstanding']==Decimal('48000')
assert total['results'][0]['total_payable']-total['results'][0]['paid']==total['results'][0]['outstanding']
details=total['results'][0]['installments']
assert next(d for d in details if d['id']==2)['balance']==Decimal('4000')
all_pending=read(day_wise_report,{'scope':'all_pending','customer_id':2,'to':'2026-10-15'})
assert next(d for d in all_pending['results'] if d['installment_number']==2)['balance']==Decimal('4000')
all_saved=ledger_outstanding(Ledger.objects.get(pk=2),{'to':'2026-10-15','due_scope':'all_saved'})
assert any(e['particulars']=='Due' and str(e['date'])=='2026-11-05' and e['debit']==Decimal('5000') for e in all_saved['entries'])
assert sum(e['reference']=='RV-000005' for e in all_saved['entries'])==1
current=read(day_wise_report,{'customer_id':2,'to':'2026-10-15'})
assert not any(r['installment_number']==2 for r in current['results'])
today=read(today_report,{'from':'2026-10-15','to':'2026-10-15'})
assert sum(r['key']=='RECEIPT-5' for r in today['rows'])==1
ledger=ledger_outstanding(Ledger.objects.get(pk=2),{'to':'2026-11-05'})
assert ledger['due_pending']==Decimal('4000')
assert ledger['closing_balance']==Decimal('4000')
from pathlib import Path
out=Path(__file__).resolve().parent.parent/'frontend/qa/ledger-outstanding'
(out/'three-views-actual.json').write_text(json.dumps({'total':total,'current':current,'ledger':ledger,'all_pending':all_pending,'all_saved':all_saved},default=str),encoding='utf-8')
print('PASS actual Kumar: Due 2 = 5000 - allocated 1000 = 4000; current cutoff excludes November due; Total Outstanding includes all saved receivables = 53000 - 5000 = 48000; ledger cutoff 5 November = 4000 Dr; Today receipt 5 occurs once. Read-only.')
