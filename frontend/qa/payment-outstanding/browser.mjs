// Run with Vite on :5179 and an isolated Chrome CDP session on :9239.
// All API responses are mocked; no backend data is read or changed.
// Checks the real Collection Entry component and complete shared stylesheet cascade.
import assert from 'node:assert/strict';
import { writeFileSync,readFileSync } from 'node:fs';
const actual=JSON.parse(readFileSync('frontend/qa/payment-outstanding/kumar-readonly.json','utf8'));
const dues=actual.snapshot.installments.map(row=>({...row,loan:row.loan_id,balance:row.outstanding_amount}));
const targets=await(await fetch('http://127.0.0.1:9239/json')).json();
const posted=[];let emptyDues=false;
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let n=0;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
ws.onmessage=async e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result)}if(m.method==='Fetch.requestPaused'){
 const {requestId,request}=m.params;const u=request.url;let data=[];
 if(request.method==='POST'){posted.push({url:u,body:JSON.parse(request.postData)});data={voucher_no:'QA-1'};}
 else if(u.includes('reports/day-wise/'))data=actual.reports.pending.data;
 else if(u.includes('reports/loan-wise/'))data=actual.reports.outstanding.data;
 else if(u.includes('/finance/customer-loan-installments/'))data=dues;
 else if(u.includes('/finance/ledgers/'))data=[{id:2,name:'Kumar',group:'Sundry Creditors',customer:2},{id:6,name:'CASH',group:'Cash-in-Hand'},{id:7,name:'QA Bank',group:'Bank Accounts'}];
 else if(u.includes('/finance/loans/'))data=[{...actual.snapshot.loans[0],customer:{id:2,code:'CUS_002',name:'Kumar'},installments:dues}];
 else
 if(u.includes('loan-types/'))data=['Chit','Interest','Mortgage'].map((name,i)=>({id:i+1,name,is_active:true,allowed_installment_ids:[1]}));
 else if(u.includes('loan-installments/'))data=[{id:1,name:'Monthly'}];
 else if(u.includes('/customers/'))data=[{id:2,full_name:'Kumar'}];
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
 await ev(`localStorage.setItem('finance_session',JSON.stringify({token:'payment-ui-test',user:{id:1,username:'QA',is_admin:true}}));localStorage.setItem('finance_last_activity',String(Date.now()))`);
 const select=async(selector,value)=>{await ev(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(100)};
 const input=async(selector,value)=>{await ev(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(100)};
 for(const width of [1440,390]) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/payment-entry'});await pause(1400);
  const layout=()=>ev(`(()=>{let q=s=>document.querySelector(s),r=e=>{let a=e.getBoundingClientRect();return{x:a.x,y:a.y,w:a.width,h:a.height,b:a.bottom}};return{left:r(q('.ce-v2-fields')),right:r(q('.pe-preview')),form:r(q('.collection-entry-card')),footer:r(q('.collection-entry-actions')),notes:r(q('.entry-notes')),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  let first=await layout();assert.equal(first.overflow,false);assert.ok(first.footer.b<=900);if(width>600){assert.ok(Math.abs(first.left.w/first.right.w-1.5)<.03);assert.equal(first.left.y,first.right.y)}
  await select('.ledger-select-add select','2');await select('.ce-v2-grid > .entry-field:nth-child(2) select','6');await input('.currency-input input','1000');
  assert.ok(await ev(`document.querySelector('.pe-preview').innerText.includes('Kumar')&&document.querySelector('.pe-preview').innerText.includes('1,000.00')`));
  writeFileSync(`frontend/qa/payment-outstanding/payment-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  let baseline=await layout();
  await select('.ce-v2-grid > .entry-field:nth-child(2) select','7');
  for(const mode of ['UPI','NEFT','RTGS','IMPS','Cheque']){
   await select('.payment-mode-row > .entry-field select',mode);
   const current=await layout();assert.ok(Math.abs(current.form.h-baseline.form.h)<1);assert.ok(Math.abs(current.notes.y-baseline.notes.y)<1,JSON.stringify({mode,current,baseline}));assert.ok(current.footer.b<=900);
  }
  for(const selector of ['.pe-payment-details input[type=text]']){await input(selector,'QA cheque')}
  await input('.pe-payment-details input[type=date]','2026-10-15');await ev(`(()=>{let es=document.querySelectorAll('.pe-payment-details input[type=text]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(es[1],'QA Bank');es[1].dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(80);
  const count=posted.length;await ev(`document.querySelector('.payment-entry-page form').requestSubmit()`);await pause(120);assert.equal(posted.length,count+1);assert.equal(posted.at(-1).body.ledger,'2');assert.equal(posted.at(-1).body.account,'7');assert.equal(posted.at(-1).body.payment_mode,'Cheque');
  for(const route of ['pending-collection','outstanding-report']){
   await call('Page.navigate',{url:`http://127.0.0.1:5179/chitfund/${route}`});await pause(1200);
   const text=await ev(`document.querySelector('.collection-report-page').innerText`);assert.ok(text.includes('Kumar'));assert.ok(text.includes(route==='pending-collection'?'4,000.00':'48,000.00'),text);
   if(route==='pending-collection') {
    assert.ok(await ev(`[...document.querySelectorAll('.report-table-wrap tbody tr')].some(r=>r.innerText.includes('Kumar')&&r.innerText.includes('2026-11-05')&&r.innerText.includes('5,000.00')&&r.innerText.includes('4,000.00'))`));
    await ev(`[...document.querySelectorAll('.report-table-wrap tbody tr')].find(r=>r.innerText.includes('2026-11-05')).click()`);await pause(80);
    const details=await ev(`document.querySelector('.report-detail-dialog').innerText`);for(const value of ['5,000.00','1,000.00','4,000.00'])assert.ok(details.includes(value));
    await ev(`document.querySelector('.report-detail-dialog [aria-label=Close]').click()`);await pause(60);
   }
  }
  console.log(`PASS ${width}px: Payment 60/40, stable Cash/Bank modes, correct unchanged Save payload; actual Kumar report data shows 4000 due balance and 48000 full-loan outstanding`);
 }
}finally {await call('Fetch.disable');await ev(`localStorage.removeItem('finance_session');localStorage.removeItem('finance_last_activity')`);ws.close()}
