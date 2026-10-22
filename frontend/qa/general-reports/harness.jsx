// Mounts the real app (main.jsx -> App -> Sidebar + route table) with every API call answered
// from in-memory fixtures, so General Reports navigation can be exercised without a backend.
import axios from 'axios';
const requests = window.qaRequests = [];
const row = { id: 1, installment_id: 11, loan_name: 'QA Chit Plan', loan_no: 'CH-0001', customer_name: 'QA Kumar', customer_code: 'CUS_001',
  due_date: '2026-10-08', due_amount: '1000.00', total_paid: '200.00', balance: '800.00', payment_status: 'PARTIAL', is_overdue: false, days_overdue: 0, due_days: 3 };
const summary = { today_due: '1000.00', today_collected: '200.00', today_remaining: '800.00', yesterday_pending: '150.00', yesterday_count: 1, total_overdue: '300.00' };
const todayRow = { key: 'LOAN-9', date: '2026-10-08', transaction_type: 'Loan', loan_type: 'Chit', loan_id: 9, loan_no: 'CH-0009', customer: 'QA Kumar',
  particulars: 'QA Today Loan — Chit Loan Application', voucher_no: 'CH-0009', amount: '5000.00' };
const payment = { id: 5, date: '2026-10-08', payment_date: '2026-10-08', particulars: 'QA Payment', voucher_no: 'PV-000005', debit: '500.00', credit: '0.00', amount: '500.00' };
axios.defaults.adapter = async config => {
  const url = String(config.url).replace(/^https?:\/\/[^/]+\/api/, '');
  requests.push({ url, method: config.method, params: config.params });
  if (config.method !== 'get') throw new Error('QA harness is read-only: ' + config.method + ' ' + url);
  const data = url.startsWith('/auth/company-profile/') ? { company_name: 'Isolated QA Finance', address: 'QA Address', phone: '1234567890', logo: '' }
    : url.startsWith('/finance/reports/today-collection/') ? { as_of: '2026-10-08', documents_allowed: false, rows: [{ key: 'INSTALLMENT-1', transaction_id: 9, document_kind: 'loan',
        installment_id: 1, date: '2026-10-01', transaction_type: 'Overdue', loan_type: 'Chit', loan_id: 9, loan_no: 'CH-0009', customer: 'QA Kumar',
        particulars: 'QA Kumar — QA Chit Plan (Inst #1)', due_amount: '50.00', paid_amount: '0.00', amount: '50.00', due_days: 7, document_count: null }] }
    : url.startsWith('/finance/reports/today/') ? { rows: [todayRow], totals: { Loan: { count: 1, amount: '5000.00' }, Receipt: { count: 0, amount: '0.00' }, Payment: { count: 0, amount: '0.00' } } }
    : url.startsWith('/finance/collections/summary/') ? summary
    : url.startsWith('/finance/collections/') ? { results: [row] }
    : url.startsWith('/finance/payment-entries/') ? [payment]
    : [];
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};
localStorage.setItem('finance_session', JSON.stringify({ token: 'qa-only', user: { username: 'qa-admin', is_admin: true, can_write: true } }));
localStorage.setItem('finance_last_activity', String(Date.now()));
localStorage.removeItem('finance_sidebar_collapsed');
window.history.replaceState({}, '', '/chitfund/today-collection');
await import('../../src/main.jsx');
