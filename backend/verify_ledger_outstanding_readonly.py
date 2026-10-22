import os,json
os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django;django.setup()
from decimal import Decimal
from finance.models import Ledger,PartyDue,PartyCollection
from finance.party_collection import ledger_outstanding
kumar=Ledger.objects.get(pk=2)
a=ledger_outstanding(kumar,{'to':'2026-11-05'})
assert a['due_pending']==Decimal('4000')
assert a['closing_balance']==Decimal('4000')
assert a['unallocated_others']==0
print('PASS actual Kumar / Ledger 2 at 2026-11-05: due-wise pending 4000; due/receipt ledger closing 4000 Dr; allocations preserved')
samples=[]
for ledger in Ledger.objects.exclude(group__in=['Cash-in-Hand','Bank Accounts']):
 result=ledger_outstanding(ledger,{'to':'2026-10-15'})
 if result['entries']:
  samples.append({k:result[k] for k in ['party','party_name','total_due','allocated_collection','due_pending','unallocated_others','closing_balance','entries']})
print('ACTUAL_SAVED_SCENARIOS='+json.dumps(samples,default=str))
from pathlib import Path
out=Path(__file__).resolve().parent.parent/'frontend/qa/ledger-outstanding'
out.mkdir(parents=True,exist_ok=True)
(out/'actual-readonly.json').write_text(json.dumps({'kumar':a,'saved':samples},default=str),encoding='utf-8')
print('Read-only verification complete. No records created, edited or deleted.')
