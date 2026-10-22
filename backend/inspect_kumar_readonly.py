import os,json
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django;django.setup()
from customers.models import Customer
from finance.models import Ledger,CustomerLoanDetails,CustomerLoanInstallmentDetails,CollectionTransaction,CollectionAllocation,PartyDue,PartyCollection
from django.db.models import Q
cs=list(Customer.objects.filter(full_name__icontains='kumar').values('id','full_name','customer_code'))
ids=[c['id'] for c in cs]
ls=list(Ledger.objects.filter(Q(customer_id__in=ids)|Q(name__icontains='kumar')).values('id','name','customer_id','group','collection_type'))
li=[l['id'] for l in ls]
loans=list(CustomerLoanDetails.objects.filter(customer_id__in=ids).values('id','customer_id','loan_no','paid_amount','outstanding_amount'))
lids=[l['id'] for l in loans]
snapshot={'customers':cs,'ledgers':ls,'loans':loans,'installments':list(CustomerLoanInstallmentDetails.objects.filter(loan_id__in=lids).values('id','loan_id','installment_number','due_date','installment_amount','paid_amount','outstanding_amount')),'receipts':list(CollectionTransaction.objects.filter(Q(customer_id__in=ids)|Q(party_ledger_id__in=li)).values('id','loan_id','installment_id','party_ledger_id','account_id','collection_amount','collection_date')),'allocations':list(CollectionAllocation.objects.filter(transaction__customer_id__in=ids).values('transaction_id','installment_id','amount')),'ledger_dues':list(PartyDue.objects.filter(party_id__in=li).values('id','party_id','due_date','amount')),'others':list(PartyCollection.objects.filter(party_id__in=li).values('id','party_id','amount','date','account_id'))}


from rest_framework.test import APIRequestFactory, force_authenticate
from django.contrib.auth.models import User
from finance.views import day_wise_report, loan_wise_report, today_report, customer_wise_report, ledger_statement
factory=APIRequestFactory()
user=User.objects.filter(is_staff=True).first()
checks={}
for name,view,params in [
 ('pending',day_wise_report,{'customer_id':2}),
 ('outstanding',loan_wise_report,{'customer_id':2}),
 ('today',today_report,{'from':'2026-10-15','to':'2026-10-15'}),
 ('customer_history',customer_wise_report,{'customer':2,'to':'2026-11-05'}),
 ('kumar_ledger',ledger_statement,{'type':'ledger','ledger':2}),
 ('cash_bank',ledger_statement,{'type':'ledger','ledger':6}),
]:
 try:
  req=factory.get('/api/verify/',params);force_authenticate(req,user=user)
  response=view(req)
  checks[name]={'status':response.status_code,'data':response.data}
 except Exception as e:checks[name]={'error':str(e)}

from decimal import Decimal
assert all(value.get('status') == 200 for value in checks.values()), {k:v.get('error',v.get('status')) for k,v in checks.items()}
due=next(row for row in checks['pending']['data']['results'] if row['loan_id']==1 and row['installment_number']==2)
assert (due['scheduled'],due['paid'],due['balance']) == (Decimal('5000'),Decimal('1000'),Decimal('4000'))
assert len([row for row in checks['today']['data']['rows'] if row['key']=='RECEIPT-5'])==1
history=checks['customer_history']['data']['results'][0]['rows']
assert any(row['debit']==Decimal('5000') and str(row['date'])=='2026-11-05' for row in history)
assert any(row['voucher_no']=='RV-000005' and row['credit']==Decimal('1000') for row in history)
assert any(row['reference']=='RV-000005' and row['credit']==Decimal('1000') for row in checks['kumar_ledger']['data']['rows'])
assert any(row['reference']=='RV-000005' and row['debit']==Decimal('1000') for row in checks['cash_bank']['data']['rows'])
from pathlib import Path
out=Path(__file__).resolve().parent.parent/'frontend/qa/payment-outstanding'
out.mkdir(parents=True,exist_ok=True)
(out/'kumar-readonly.json').write_text(json.dumps({'snapshot':snapshot,'reports':checks},default=str),encoding='utf-8')
print('PASS actual database: Customer 2 / Ledger 2 / Loan 1 / Due 2; 5000 - 1000 = 4000; receipt 5 appears once; customer history debit/credit correct; account 6 Dr 1000 and ledger 2 Cr 1000. No database writes.')
