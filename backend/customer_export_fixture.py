"""Generate synthetic browser fixtures through the real isolated report API."""
import os
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.kyc_test_settings'
import django
django.setup()
from django.conf import settings
settings.ALLOWED_HOSTS = ['testserver']
import json
from pathlib import Path
from django.core.management import call_command
from django.core.serializers.json import DjangoJSONEncoder
from finance.test_customer_wise_report import CustomerWiseReportTests
from finance.models import CustomerLoanInstallmentDetails

call_command('migrate', run_syncdb=True, verbosity=0)
case = CustomerWiseReportTests()
case.setUp()
selected = case.loan(case.kumar, 'Chit')
case.loan(case.kumar, 'Interest')
case.loan(case.ravi, 'Chit')
installment = CustomerLoanInstallmentDetails.objects.filter(loan_id=selected['id']).first()
response = case.client.post(f'/api/finance/customer-loan-installments/{installment.pk}/collect/',
    {'customer_paid_amount': '20', 'payment_date': str(installment.due_date), 'payment_mode': 'Cash'}, format='json')
assert response.status_code == 200, response.data
fixture = {
    'selectedLoanId': selected['id'],
    'selectedLoanDocNo': selected['doc_no'],
    'customers': case.client.get('/api/customers/').data,
    'loans': case.client.get('/api/finance/loans/').data['results'],
    'all': case.report(customer=case.kumar.pk),
    'selected': case.report(customer=case.kumar.pk, loan_id=selected['id']),
}
fixture['byLoan'] = {str(loan['id']): case.report(customer=loan['customer']['id'], loan_id=loan['id']) for loan in fixture['loans']}
fixture['byCustomer'] = {str(customer['id']): case.report(customer=customer['id']) for customer in fixture['customers']}
Path('../frontend/qa/customer-export/fixture.json').write_text(json.dumps(fixture, cls=DjangoJSONEncoder), encoding='utf-8')
print('Generated isolated real-API report fixture.')
