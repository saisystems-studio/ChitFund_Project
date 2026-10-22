// Run with Vite on :5179 and an isolated Chrome CDP session on :9239.
// All API responses are mocked; no backend data is read or changed.
// Checks the real Collection Entry component and complete shared stylesheet cascade.
import assert from 'node:assert/strict';
import { writeFileSync,readFileSync } from 'node:fs';
const three=JSON.parse(readFileSync('frontend/qa/ledger-outstanding/three-views-actual.json','utf8'));
const saved=JSON.parse(readFileSync('frontend/qa/ledger-outstanding/actual-readonly.json','utf8'));
const rent=saved.saved.find(r=>r.party===13);

const targets=await(await fetch('http://127.0.0.1:9239/json')).json();
const posted=[];let emptyDues=false;
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let n=0;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
ws.onmessage=async e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result)}if(m.method==='Fetch.requestPaused'){
 const {requestId,request}=m.params;const u=request.url;let data=[];
 if(request.method==='POST'){posted.push({url:u,body:JSON.parse(request.postData)});data={voucher_no:'QA-1'};}
 else if(u.includes('party-collections/summary')){
  const params=new URL(u).searchParams;const original=params.get('party')==='2'?(params.get('due_scope')==='all_saved'?three.all_saved:saved.kumar):{...rent,opening_balance:0,allocated_collection:rent.allocated_collection,due_pending:rent.due_pending,unallocated_others:rent.unallocated_others,future_receivables:0,total_outstanding:0};
  data={...original,entries:original.entries.filter(row=>!params.get('from')||row.date>=params.get('from'))};
 }

 else if(u.includes('/finance/ledgers/'))data=[{id:2,name:'Kumar',group:'Sundry Creditors',customer:2},{id:13,name:'Rent',group:'Income'}];
 else if(u.includes('/finance/reports/loan-wise/'))data=new URL(u).searchParams.get('scope')==='total'?{...three.total,results:new URL(u).searchParams.get('status')==='OVERDUE'?[]:three.total.results}:{summary:{},results:[]};
 else if(u.includes('/finance/reports/day-wise/'))data=new URL(u).searchParams.get('scope')==='all_pending'?three.all_pending:three.current;
 else if(u.includes('/finance/loans/'))data=three.total.results.map(r=>({id:r.loan_id,loan_no:r.loan_no,customer:{id:2,code:'CUS_002',name:'Kumar'},installments:[]}));
 else
 if(u.includes('loan-types/'))data=['Chit','Interest','Mortgage'].map((name,i)=>({id:i+1,name,is_active:true,allowed_installment_ids:[1]}));
 else if(u.includes('loan-installments/'))data=[{id:1,name:'Monthly'}];
 else if(u.includes('/customers/'))data=[{id:1,full_name:'QA Customer'}];
 else if(u.includes('application-date'))data={application_date:'2026-10-15'};
 else if(u.includes('auth/me'))data={id:1,username:'layout-qa',is_admin:true};
 if(emptyDues && u.includes('/finance/loans/'))data=data.map(loan=>({...loan,installments:loan.installments.map(row=>({...row,balance:0,paid_amount:row.installment_amount}))}));
 if(u.includes('/finance/loans/10/'))data=Array.isArray(data)?data[0]:data;
 await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
}};
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try {
 await call('Fetch.enable',{patterns:[{urlPattern:'*/api/*'}]});
 await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/login'});await pause(900);
 await ev(`localStorage.setItem('finance_session',JSON.stringify({token:'three-views-ui-test',user:{id:1,username:'QA',is_admin:true}}));localStorage.setItem('finance_last_activity',String(Date.now()))`);
 const select=async(selector,value)=>{await ev(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(250)};
 const checkOptions=async()=>assert.deepEqual(await ev(`[...document.querySelector('[aria-label="Report scope"]').options].map(o=>o.text)`),['Loan Dues','Total Outstanding','Ledger Outstanding']);
 for(const width of [1440,390]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/pending-collection'});await pause(1400);await checkOptions();
  await select('[aria-label="Report scope"]','total');await pause(300);await checkOptions();
  assert.ok(await ev(`document.querySelector('.total-outstanding-table').innerText.includes('Kumar')&&document.querySelector('.total-outstanding-table').innerText.includes('48,000.00')`));
  assert.deepEqual(await ev(`[...document.querySelectorAll('.total-outstanding-table thead th')].map(e=>e.textContent)`),['Customer','Loan Number','Total Due','Collected','Remaining Balance','Unallocated Others']);
  await ev(`document.querySelector('.total-outstanding-table tbody tr').click()`);
  assert.ok(await ev(`document.querySelector('.installment-breakdown').innerText.includes('4,000.00') && document.querySelector('.installment-breakdown').innerText.includes('RV-000005')`));
  await ev(`document.querySelector('.total-outstanding-table tbody tr').click()`);
  assert.equal(await ev(`document.querySelector('.installment-breakdown')`),null);
  assert.ok(await ev(`document.querySelector('.ledger-outstanding-pagination').textContent.includes('Page 1 of 1')`));
  await select('.report-filter-bar label:nth-child(2) select','OVERDUE');await pause(100);assert.ok(!(await ev(`document.querySelector('.total-outstanding-table').innerText`)).includes('Kumar'));
  await select('.report-filter-bar label:nth-child(2) select','');await pause(100);assert.ok((await ev(`document.querySelector('.total-outstanding-table').innerText`)).includes('Kumar'));
  await select('[aria-label="Report scope"]','ledger');await pause(250);await checkOptions();
  assert.equal(await ev(`document.querySelector('[aria-label="Ledger status filter"]').disabled`),true);
  assert.equal(await ev(`document.querySelector('[aria-label="Ledger loan filter"]').disabled`),true);
  await select('.report-filter-bar select','2');await pause(200);
  assert.deepEqual(await ev(`[...document.querySelectorAll('.ledger-outstanding-table thead th')].map(e=>e.textContent)`),['Date','Customer','Particulars','Voucher No','Dr','Cr','Running Balance']);
  assert.ok((await ev(`document.querySelector('.ledger-outstanding-table').innerText`)).includes('RV-000005'));
  await select('[aria-label="Ledger due scope"]','all_saved');await pause(200);
  assert.ok((await ev(`document.querySelector('.ledger-outstanding-table').innerText`)).includes('05/11/2026'));
  assert.equal(await ev(`[...document.querySelectorAll('.ledger-outstanding-table tbody tr')].filter(r=>r.innerText.includes('RV-000005')).length`),1);
  await select('[aria-label="Report scope"]','loans');await pause(150);await checkOptions();assert.equal(await ev(`document.querySelector('.total-outstanding-table')===null&&document.querySelector('.ledger-outstanding-table')===null`),true);
  await select('[aria-label="Due scope"]','all_pending');await pause(250);
  assert.ok(await ev(`document.querySelector('.report-table-pending').innerText.includes('4,000.00')`));
  assert.equal(await ev(`document.documentElement.scrollWidth>innerWidth`),false);
  console.log(`PASS ${width}px: three views in existing page, Total Outstanding actual receivables, no future-as-overdue, Ledger columns, disabled irrelevant filters, pagination and return to Loan Dues`);
 }
}finally{await call('Fetch.disable');await ev(`localStorage.removeItem('finance_session');localStorage.removeItem('finance_last_activity')`);ws.close()}
