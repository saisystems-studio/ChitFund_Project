import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django;django.setup()
from decimal import Decimal
from django.contrib.auth.models import User
from rest_framework.test import APIRequestFactory,force_authenticate
from finance.views import day_wise_report,loan_wise_report
factory=APIRequestFactory();user=User.objects.filter(is_staff=True).first()
for cutoff in ['2026-10-15','2026-11-05']:
 req=factory.get('/verify/',{'customer_id':2,'to':cutoff});force_authenticate(req,user=user)
 response=day_wise_report(req);assert response.status_code==200
 rows=response.data['results']
 match=[r for r in rows if r['loan_id']==1 and r['installment_number']==2]
 assert all(str(r['due_date'])<=cutoff and r['balance']>0 for r in rows)
 if cutoff=='2026-10-15':assert not match
 else:
  assert len(match)==1
  assert (match[0]['scheduled'],match[0]['paid'],match[0]['balance'])==(Decimal('5000'),Decimal('1000'),Decimal('4000'))
 req=factory.get('/verify/',{'customer_id':2,'to':cutoff});force_authenticate(req,user=user)
 grouped=loan_wise_report(req).data['results']
 assert sum(r['outstanding'] for r in grouped)==sum(r['balance'] for r in rows)
 print(f'PASS actual Kumar records at {cutoff}: due 2 '+('excluded' if not match else '5000 - 1000 = 4000')+'; loan summary agrees; no database writes')
