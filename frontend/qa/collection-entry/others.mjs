// Run with Vite on :5179 and an isolated Chrome CDP session on :9239.
// All API responses are mocked; no backend data is read or changed.
// Checks the real Collection Entry component and complete shared stylesheet cascade.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const targets=await(await fetch('http://127.0.0.1:9239/json')).json();
const posted=[];let emptyDues=false;
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let n=0;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
ws.onmessage=async e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result)}if(m.method==='Fetch.requestPaused'){
 const {requestId,request}=m.params;const u=request.url;let data=[];
 if(request.method==='POST'){posted.push({url:u,body:JSON.parse(request.postData)});data={voucher_no:'QA-1'};}
 else if(u.includes('party-collections/summary'))data={party:4,party_name:'Rent',collection_type:'',total_due:5000,total_received:3000,outstanding:2000,outstanding_type:'DR',due_balance:2000,due_balance_type:'DR',remaining_outstanding:2000,unallocated_credit:3000,unallocated_advance:3000,entries:[{date:'2026-10-08',particulars:'Due',reference:'RENT-1',debit:5000,credit:0},{date:'2026-10-15',particulars:'Others Collection',reference:'PC-1',debit:0,credit:3000}]};
 else if(u.includes('/finance/ledgers/'))data=[{id:1,name:'Loan Customer',group:'Sundry Debtors',customer:1},{id:2,name:'Due Customer',group:'Sundry Debtors',collection_type:'DUE_WISE'},{id:3,name:'Cash Account',group:'Cash-in-Hand'},{id:4,name:'Rent',group:'Indirect Expense'}];
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
 await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/login'});await pause(800);
 await ev(`localStorage.setItem('finance_session',JSON.stringify({token:'others-ui-test',user:{id:1,username:'QA',is_admin:true}}));localStorage.setItem('finance_last_activity',String(Date.now()))`);
 const select=async(selector,value)=>{await ev(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(100)};
 const input=async(selector,value)=>{await ev(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(100)};
 for(const width of [1440,390]) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/collection-entry'});await pause(1400);
  await ev(`document.querySelector('.entry-picker-button').click()`);await pause(100);await ev(`[...document.querySelectorAll('.entry-customer-options button')].find(e=>e.textContent==='Rent').click()`);await pause(200);
  assert.equal(await ev(`document.querySelectorAll('.ce-v2-grid select')[1].disabled`),true);
  assert.equal(await ev(`!!document.querySelector('.ce-v2-statement-button')`),false);
  await select('.ce-v2-grid select','3');await input('.currency-input input','3000');await input('[aria-label="Date"]','2026-10-15');
  const count=posted.length;await ev(`document.querySelector('.ce-v2 form').requestSubmit()`);await pause(80);assert.equal(posted.length,count);
  await ev(`document.querySelector('.ce-others-option input').click()`);await pause(80);
  assert.equal(await ev(`document.querySelector('[aria-label="Others Collection Amount"]').value`),'3000');
  await input('[aria-label="Others Collection Amount"]','2500');assert.equal(await ev(`document.querySelector('.currency-input input').value`),'2500');
  await input('.currency-input input','3000');assert.equal(await ev(`document.querySelector('[aria-label="Others Collection Amount"]').value`),'3000');
  await ev(`document.querySelector('.ce-v2 form').requestSubmit();document.querySelector('.ce-v2 form').requestSubmit()`);await pause(150);
  assert.equal(posted.length,count+1);assert.equal(posted.at(-1).body.party,4);assert.equal(posted.at(-1).body.amount,'3000');assert.equal(posted.at(-1).body.date,'2026-10-15');assert.ok(!posted.at(-1).body.loan_id);assert.ok(!posted.at(-1).body.allocations);
  await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/reports/party-collection'});await pause(1100);
  await select('.rpt-page select','4');await pause(150);
  const text=await ev(`document.querySelector('.rpt-page').innerText`);
  for(const word of ['08/10/2026','15/10/2026','Others Collection','2,000.00 Dr','Pending Outstanding'])assert.ok(text.includes(word),word);
  assert.equal(await ev(`document.documentElement.scrollWidth>innerWidth`),false);
  await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/pending-collection'});await pause(1000);
  await select('[aria-label="Report scope"]','ledger');await pause(200);await select('.rpt-field select','4');await pause(100);assert.ok(await ev(`document.body.innerText.includes('Others Collection')`));
  console.log(`PASS ${width}px: normal Ledger Others, editable amount, no loan required, one dated voucher, dated Dr/Cr report and 2000 Dr closing`);
 }
}finally {await call('Fetch.disable');await ev(`localStorage.removeItem('finance_session');localStorage.removeItem('finance_last_activity')`);ws.close()}
