import React from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
axios.defaults.adapter = async config => {
  if (config.url !== '/auth/company-profile/') throw new Error('Unexpected external request');
  return { data: { company_name: 'Isolated QA Finance', address: 'QA Test Address', phone: '1234567890', logo: '' }, status: 200, statusText: 'OK', headers: {}, config };
};
const { default: CustomerReportDetail } = await import('../../src/pages/modules/CustomerReportDetail');
const { CompanyProfileProvider } = await import('../../src/components/CompanyProfileContext');
const requests = window.qaRequests = [];
const fixture = await (await fetch('/chitfund/qa/customer-export/fixture.json')).json();
const api = { get: async (url, options) => {
  requests.push({ url, options });
  if (options.headers?.Authorization !== 'Token qa-only') throw new Error('Missing auth');
  if (url === '/customers/') return { data: location.search.includes('many') ? [...fixture.customers, ...Array.from({length:40},(_,i)=>({id:100+i,full_name:'QA Customer '+i,primary_mobile:'9876500001'}))] : fixture.customers };
  if (url === '/finance/loans/') return { data: fixture.loans };
  if (url === '/finance/reports/customer-wise/') {
    if (String(options.params.loan_id) === '2' && window.qaDelayLoan) await new Promise(resolve => setTimeout(resolve, window.qaDelayLoan));
    const source = structuredClone(options.params.loan_id ? fixture.byLoan[String(options.params.loan_id)] : fixture.byCustomer[String(options.params.customer)]);
    if (options.params.from || options.params.to) source.results.forEach(result => { result.rows = result.rows.filter(row => row.is_opening || ((!options.params.from || row.date >= options.params.from) && (!options.params.to || row.date <= options.params.to))); });
    return { data: source };
  }
  throw new Error('Unexpected request');
} };
window.mountReport = () => root.render(<CompanyProfileProvider><CustomerReportDetail key={Date.now()} api={api} auth={{ headers: { Authorization: 'Token qa-only' } }} go={() => root.render(<button onClick={window.mountReport}>Return</button>)}/></CompanyProfileProvider>);
const root = createRoot(document.getElementById('root'));
window.mountReport();
