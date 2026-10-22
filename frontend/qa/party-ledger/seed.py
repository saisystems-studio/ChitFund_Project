from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient
from finance.models import ChitGroup, ChitGroupInstallmentDetail, Group, Ledger, LoanInstallment, LoanType
from staff.models import Staff
c = APIClient(); c.force_authenticate(User.objects.get(username="qa"))
debtors = Group.objects.get(name="Sundry Debtors", parent=None)
income = Group.objects.get(name="Indirect Income", parent=None)
def post(url, data):
    r = c.post(url, data, format="json"); assert r.status_code in (200, 201), (url, r.status_code, r.data); return r.data
post("/api/finance/ledgers/", {"name": "CASH", "group_detail": Group.objects.get(name="Cash-in-Hand").pk, "opening_balance": "0"})
post("/api/finance/ledgers/", {"name": "KVB", "group_detail": Group.objects.get(name="Bank Accounts").pk, "opening_balance": "0", "bank_name": "KVB", "branch_name": "Karur", "ifsc_code": "KVBL0001234", "account_number": "1234567890"})
post("/api/finance/ledgers/", {"name": "Rent", "group_detail": income.pk, "opening_balance": "0"})
post("/api/finance/ledgers/", {"name": "Due Income", "group_detail": income.pk, "opening_balance": "0"})
post("/api/finance/ledgers/", {"name": "Party A", "group_detail": debtors.pk, "opening_balance": "0", "collection_type": "DUE_WISE"})
Staff.objects.create(staff_id="ST001", staff_name="Ravi Resource", phone_number="9876500099") if not Staff.objects.exists() else None
kumar = post("/api/customers/", {"full_name": "Kumar", "primary_mobile": "9876500001", "group": debtors.pk, "address": "12 Main Street", "district": "Karur", "state": "Tamil Nadu", "country": "India"})
chit = LoanType.objects.get_or_create(name="Chit")[0]
for name in ("Interest", "Mortgage"): LoanType.objects.get_or_create(name=name)
LoanInstallment.objects.get_or_create(name="Daily", defaults={"code": "DAILY"})
group = ChitGroup.objects.create(code="QA1", name="QA Chit", duration=3, duration_type="DAY", grand_total=12000)
for n, amount in enumerate((6000, 1000, 5000), start=1):
    ChitGroupInstallmentDetail.objects.create(group=group, installment_number=n, schedule_value=str(n), installment_amount=amount)
loan = post("/api/finance/loans/", {"customer_id": kumar["id"], "loan_type_id": chit.pk, "amount": "12000", "start_date": timezone.localdate().isoformat(), "chit_group_id": group.pk, "include_sunday": True})
print("seeded kumar", kumar["id"], "ledger", kumar["ledger_id"], "loan", loan["id"], [(i["id"], i["installment_number"], i["installment_amount"]) for i in loan["installments"]])
