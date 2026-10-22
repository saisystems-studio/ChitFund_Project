// Run with Vite on :5179 and an isolated Chrome CDP session on :9239.
// All API responses are mocked; no backend data is read or changed.
// Checks the real Collection Entry component and complete shared stylesheet cascade.
import assert from 'node:assert/strict';
import { writeFileSync,readFileSync } from 'node:fs';
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
  const params=new URL(u).searchParams;const original=params.get('party')==='2'?saved.kumar:{...rent,opening_balance:0,allocated_collection:rent.allocated_collection,due_pending:rent.due_pending,unallocated_others:rent.unallocated_others,future_receivables:0,total_outstanding:0};
  data={...original,entries:original.entries.filter(row=>!params.get('from')||row.date>=params.get('from'))};
 }

 else if(u.includes('/finance/ledgers/'))data=[{id:2,name:'Kumar',group:'Sundry Creditors',customer:2},{id:13,name:'Rent',group:'Income'}];
 else if(u.includes('/finance/loans/'))data=[{id:10,customer_id:1,loan_no:'LN1',status:'Active',loan_type:{name:'Chit'},installments:[3000,3000,2000,1000,6000].map((balance,i)=>({id:i+11,installment_number:i+1,due_date:`2026-0${i+1}-01`,installment_amount:balance+100,paid_amount:100,balance})).reverse()}];
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
 await ev(`localStorage.setItem('finance_session',JSON.stringify({token:'ledger-ui-test',user:{id:1,username:'QA',is_admin:true}}));localStorage.setItem('finance_last_activity',String(Date.now()))`);
 const select=async(selector,value)=>{await ev(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(180)};
 for(const width of [1440,390]) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/pending-collection'});await pause(1200);
  await select('[aria-label="Report scope"]','ledger');await pause(300);
  assert.equal(await ev(`document.querySelector('.collection-report-page')!==null`),true);
  await ev(`(()=>{let e=document.querySelectorAll('input[type=date]')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'2026-11-05');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(100);
  await select('.report-filter-bar select','2');await pause(220);
  const text=()=>ev(`document.querySelector('.collection-report-page').innerText`);
  for(const word of ['Ledger Outstanding','Total Allocated Collection','Total Due-wise Pending','Unallocated Others','Net Ledger Outstanding','4,000.00 Dr','RV-000005','CH-0001 / Due 2'])assert.ok((await text()).includes(word),word);
  const table=await ev(`(()=>{let t=document.querySelector('.ledger-outstanding-table');return {rows:t.tBodies[0].rows.length,headers:t.tHead.rows[0].cells.length,align:getComputedStyle(t.tBodies[0].rows[1].cells[4]).textAlign,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  assert.equal(table.headers,6);assert.equal(table.align,'right');assert.equal(table.overflow,false);
  writeFileSync(`frontend/qa/ledger-outstanding/ledger-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await select('.report-filter-bar select','13');await pause(220);
  for(const word of ['Others','PC-000001','5,000.00 Cr'])assert.ok((await text()).includes(word),word);
  assert.equal(await ev(`[...document.querySelectorAll('.ledger-outstanding-table tbody tr')].some(r=>r.cells[1]?.textContent==='Due')`),false,'no invented Rent due');
  await select('[aria-label="Report scope"]','loans');await pause(150);assert.equal(await ev(`document.querySelector('.ledger-outstanding-table')===null`),true);
  console.log(`PASS ${width}px: existing report dropdown and container, actual Kumar 4000 Dr, separated summaries, actual Rent unallocated credit with no invented due, dates, right-aligned amounts, pagination controls`);
 }
}finally{await call('Fetch.disable');await ev(`localStorage.removeItem('finance_session');localStorage.removeItem('finance_last_activity')`);ws.close()}
