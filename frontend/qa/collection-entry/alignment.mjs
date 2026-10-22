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
 else if(u.includes('/finance/loans/'))data=[{id:10,customer_id:1,loan_no:'LN1',status:'Active',loan_type:{name:'Chit'},installments:[{id:11,installment_number:1,due_date:'2026-10-15',installment_amount:100,paid_amount:0,balance:100},...Array.from({length:20},(_,i)=>({id:i+12,installment_number:i+2,due_date:'2026-10-15',installment_amount:100,paid_amount:50,balance:50})),{id:90,installment_number:99,installment_amount:100,paid_amount:100,balance:0}]}];
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
try{
 await call('Fetch.enable',{patterns:[{urlPattern:'*/api/*'}]});
 await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/login'});await pause(800);
 await ev(`localStorage.setItem('finance_session',JSON.stringify({token:'isolated-ui-test',user:{id:1,username:'QA',is_admin:true}}));localStorage.setItem('finance_last_activity',String(Date.now()))`);
 await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/collection-entry'});await pause(1500);
 const select=async(index,value)=>{await ev(`(()=>{const e=document.querySelectorAll('.ce-v2-grid select')[${index}];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(120)};
 const ledger=async name=>{await ev(`document.querySelector('.entry-picker-button').click()`);await pause(150);await ev(`[...document.querySelectorAll('.entry-customer-options button')].find(e=>e.textContent===${JSON.stringify(name)}).click()`);await pause(200)};
 for(const width of [1440,390]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await pause(250);
  await ledger('Loan Customer');await select(0,'3');
  const layout=await ev(`(()=>{let rect=e=>{let r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,b:r.bottom}},q=s=>document.querySelector(s);return {left:rect(q('.ce-v2-fields')),right:rect(q('.ce-v2-preview')),footer:rect(q('.collection-entry-actions')),checks:q('.ce-v2-preview input[type=checkbox]')!==null,tabs:document.querySelectorAll('[role=tab]').length,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
  assert.equal(layout.tabs,0);assert.equal(layout.checks,true);assert.equal(layout.overflow,false);assert.ok(layout.footer.b<=900,JSON.stringify(layout));
  if(width>600){assert.ok(layout.right.x>layout.left.x+layout.left.w);assert.ok(Math.abs(layout.left.w/layout.right.w-1.5)<.03);assert.equal(layout.left.y,layout.right.y)}else assert.ok(layout.right.y>=layout.left.y);
  const checkStatement=async selector=>{
   const m=await ev(`(()=>{const p=document.querySelector('${selector}'),s=p.querySelector('.ce-statement-scroll'),t=p.querySelector('table'),h=t.tHead,r=t.tBodies[0].rows[0];let rect=e=>{let r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};return {scroll:rect(s),header:rect(h),row:rect(r),width:s.clientWidth,content:s.scrollWidth,rows:t.tBodies[0].rows.length,footer:rect(p.querySelector('footer')),panel:rect(p),paid:p.querySelector('[aria-label="Select installment 99"]')!==null}})()`);
   assert.ok(m.scroll.height>=100,JSON.stringify(m));assert.ok(m.row.height>30);assert.ok(m.header.height>=38,JSON.stringify(m));assert.ok(m.content<=m.width+1,JSON.stringify(m));assert.ok(m.row.top>=m.header.bottom-1);assert.ok(m.row.top<m.scroll.bottom);assert.equal(m.paid,false);
   if(selector.includes('modal')){assert.ok(m.panel.top>=0);assert.ok(m.panel.bottom<=900);assert.ok(m.footer.bottom<=m.panel.bottom);}
   const sticky=await ev(`(()=>{let p=document.querySelector('${selector}'),s=p.querySelector('.ce-statement-scroll');s.scrollTop=200;return Math.abs(p.querySelector('thead').getBoundingClientRect().top-s.getBoundingClientRect().top)<2})()`);assert.ok(sticky);await ev(`document.querySelector('${selector} .ce-statement-scroll').scrollTop=0`);
  };
  await checkStatement('.ce-inline-statement');
  writeFileSync(`frontend/qa/collection-entry/preview-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await ev(`document.querySelector('.ce-v2-statement-button').click()`);await pause(100);await checkStatement('.ce-statement-modal');
  writeFileSync(`frontend/qa/collection-entry/modal-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await ev(`document.querySelector('.ce-statement-modal [aria-label="Select installment 2"]').click()`);await pause(80);
  assert.equal(await ev(`document.querySelector('.ce-inline-statement [aria-label="Select installment 2"]').checked`),true);
  await ev(`document.querySelector('.ce-inline-statement [aria-label="Select installment 2"]').click()`);await pause(80);
  assert.equal(await ev(`document.querySelector('.ce-statement-modal [aria-label="Select installment 2"]').checked`),false);
  await ev(`document.querySelector('.ce-statement-modal .apply-selection').click()`);await pause(80);assert.equal(await ev(`!!document.querySelector('.ce-statement-modal')`),false);
  await ev(`document.querySelector('.ce-v2-statement-button').click()`);await pause(80);await ev(`document.querySelector('.ce-statement-modal [aria-label="Close"]').click()`);await pause(80);assert.equal(await ev(`!!document.querySelector('.ce-statement-modal')`),false);
  await ev(`document.querySelector('.ce-v2-preview input[type=checkbox]').click()`);await pause(80);assert.equal(await ev(`document.querySelector('.ce-v2-preview input[type=checkbox]').checked`),false);
  await ev(`document.querySelector('.ce-v2-preview input[type=checkbox]').click()`);await pause(80);
  await ev(`document.querySelector('.ce-v2 form').requestSubmit()`);await pause(150);assert.ok(posted.some(p=>p.url.includes('/collect/')&&p.body.allocations[0].installment_id===11));
  await ledger('Due Customer');await select(0,'3');
  await ev(`(()=>{let e=document.querySelector('.currency-input input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'150');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(100);
  assert.equal(await ev(`document.querySelector('[aria-label="Select D1"]').checked`),true);
  await ev(`document.querySelector('[aria-label="Select Others (Advance)"]').click()`);await pause(80);
  assert.equal(await ev(`document.querySelector('[aria-label="Others (Advance) amount"]').value`),'50.00');
  await ev(`document.querySelector('.ce-v2-statement-button').click()`);await pause(80);await checkStatement('.ce-statement-modal');
  assert.equal(await ev(`document.querySelector('.ce-statement-modal [aria-label="Others (Advance) amount"]').value`),'50.00');
  await ev(`document.querySelector('.ce-statement-modal .apply-selection').click()`);await pause(80);
  await ev(`document.querySelector('.ce-v2 form').requestSubmit()`);await pause(150);
  assert.ok(posted.some(p=>p.url.includes('party-collections')&&p.body.advance_amount==='50.00'&&p.body.allocations[0].amount==='100.00'));
  console.log(`PASS ${width}px: layout, no tabs, loan checkboxes/save, ledger dues and Others/save`);
 }
 emptyDues=true;
 await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/collection-entry'});await pause(1800);
 await ledger('Loan Customer');
 assert.ok(await ev(`document.querySelector('.ce-inline-statement').innerText.includes('No pending dues')`));
 assert.equal(await ev(`document.querySelectorAll('.ce-inline-statement input[type=checkbox]:not([aria-label="Select Others (Advance)"])').length`),0);
 console.log('PASS fully paid loans: clear empty state and no selectable paid dues');

}finally{await call('Fetch.disable');await ev(`localStorage.removeItem('finance_session');localStorage.removeItem('finance_last_activity')`);ws.close()}
