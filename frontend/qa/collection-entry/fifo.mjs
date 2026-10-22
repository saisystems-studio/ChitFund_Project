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
 else if(u.includes('party-collections/summary'))data={total_due:100,total_received:0,outstanding:100,dues:[{id:91,due_number:'D1',due_date:'2026-10-15',pending:100,amount:100}]};
 else if(u.includes('/finance/ledgers/'))data=[{id:1,name:'Loan Customer',group:'Sundry Debtors',customer:1},{id:2,name:'Due Customer',group:'Sundry Debtors',collection_type:'DUE_WISE'},{id:3,name:'Cash Account',group:'Cash-in-Hand'}];
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
 await ev(`localStorage.setItem('finance_session',JSON.stringify({token:'fifo-ui-test',user:{id:1,username:'QA',is_admin:true}}));localStorage.setItem('finance_last_activity',String(Date.now()))`);
 await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/collection-entry'});await pause(1600);
 const input=async(selector,value)=>{await ev(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(120)};
 const split=()=>ev(`[...document.querySelectorAll('.ce-inline-statement input[type=number]')].slice(0,5).map(e=>e.value)`);
 for(const width of [1440,390]) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await pause(150);
  await ev(`document.querySelector('.entry-picker-button').click()`);await pause(100);await ev(`[...document.querySelectorAll('.entry-customer-options button')].find(e=>e.textContent==='Loan Customer').click()`);await pause(450);
  await ev(`(()=>{let e=document.querySelector('.ce-v2-grid select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'3');e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(100);
  await input('.currency-input input','10000');
  assert.deepEqual(await split(),['3000.00','3000.00','2000.00','1000.00','1000.00']);
  assert.ok(await ev(`document.querySelector('.ce-inline-statement').innerText.includes('5,000.00')`));
  for (const panel of ['.ce-inline-statement', '.ce-statement-modal']) {
   if (panel.includes('modal')) { await ev(`document.querySelector('.ce-v2-statement-button').click()`); await pause(80); }
   const row = `${panel} tbody tr:first-child`;
   await ev(`document.querySelector('${row} td:nth-child(2) b').click()`);await pause(60);
   assert.equal(await ev(`document.querySelector('${row} input[type=checkbox]').checked`),false,'row click deselects');
   await ev(`document.querySelector('${row} td:nth-child(3)').click()`);await pause(60);
   assert.equal(await ev(`document.querySelector('${row} input[type=checkbox]').checked`),true,'row click selects');
   await ev(`document.querySelector('${row} input[type=checkbox]').click()`);await pause(60);
   assert.equal(await ev(`document.querySelector('${row} input[type=checkbox]').checked`),false,'checkbox toggles only once');
   await ev(`document.querySelector('${row} input[type=checkbox]').click()`);await pause(60);
   await ev(`document.querySelector('${row} input[type=number]').click()`);await pause(60);
   assert.equal(await ev(`document.querySelector('${row} input[type=checkbox]').checked`),true,'amount editing does not toggle');
   assert.ok(await ev(`document.querySelector('${row}').classList.contains('selected')`));
   if (panel.includes('modal')) { await ev(`document.querySelector('.ce-statement-modal .apply-selection').click()`); await pause(60); }
  }
  await input('.ce-inline-statement [aria-label="Allocate to installment 2"]','1200');await pause(200);
  assert.equal((await split())[1],'1200');
  await ev(`document.querySelector('.ce-v2-statement-button').click()`);await pause(100);
  assert.equal(await ev(`document.querySelector('.ce-statement-modal [aria-label="Allocate to installment 2"]').value`),'1200');
  await ev(`document.querySelector('.ce-statement-modal .apply-selection').click()`);await pause(80);
  await input('.currency-input input','16000');
  assert.equal(await ev(`document.querySelector('.ce-inline-statement [aria-label="Select Others (Advance)"]').checked`),false);
  const count=posted.length;
  await ev(`document.querySelector('.ce-v2 form').requestSubmit()`);await pause(80);assert.equal(posted.length,count);
  await ev(`document.querySelector('.ce-inline-statement [aria-label="Select Others (Advance)"]').click()`);await pause(80);
  assert.equal(await ev(`document.querySelector('.ce-inline-statement [aria-label="Others (Advance) amount"]').value`),'1000.00');
  await ev(`document.querySelector('.ce-v2 form').requestSubmit();document.querySelector('.ce-v2 form').requestSubmit()`);await pause(180);
  assert.equal(posted.length,count+1);assert.equal(posted.at(-1).body.advance_amount,'1000.00');assert.equal(posted.at(-1).body.allocations.length,5);assert.ok(posted.at(-1).body.request_key);
  console.log(`PASS ${width}px: actual balances, date ordering, FIFO example, partial fifth due, manual edits, popup synchronization, explicit Others, one Save request`);
 }
} finally {await call('Fetch.disable');await ev(`localStorage.removeItem('finance_session');localStorage.removeItem('finance_last_activity')`);ws.close();}
