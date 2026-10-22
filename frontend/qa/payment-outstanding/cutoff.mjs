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
 else if(u.includes('reports/day-wise/')){const cutoff=new URL(u).searchParams.get('to')||'2026-10-15';data={summary:{},results:actual.reports.pending.data.results.filter(r=>r.due_date<=cutoff&&Number(r.balance)>0)};}
 else if(u.includes('reports/loan-wise/')){const cutoff=new URL(u).searchParams.get('to')||'2026-10-15';const rows=actual.reports.pending.data.results.filter(r=>r.due_date<=cutoff&&Number(r.balance)>0);data={summary:{},results:rows.length?[{...actual.reports.outstanding.data.results[0],due_date:rows[0].due_date,outstanding:rows.reduce((sum,r)=>sum+Number(r.balance),0)}]:[]};}
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
 await ev(`localStorage.setItem('finance_session',JSON.stringify({token:'cutoff-ui-test',user:{id:1,username:'QA',is_admin:true}}));localStorage.setItem('finance_last_activity',String(Date.now()))`);
 for(const width of [1440,390]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  for(const route of ['pending-collection','outstanding-report']){
   await call('Page.navigate',{url:`http://127.0.0.1:5179/chitfund/${route}`});await pause(1200);
   const text=()=>ev(`document.querySelector('.report-table-wrap').innerText`);
   assert.ok(!(await text()).includes('Kumar'));
   for(const value of ['2026-11-05','2026-10-15']) {
    await ev(`(()=>{const e=document.querySelectorAll('input[type=date]')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(350);
    if(value==='2026-11-05'){assert.ok((await text()).includes('Kumar'));assert.ok((await text()).includes('4,000.00'))}
    else assert.ok(!(await text()).includes('Kumar'));
   }
  }
  console.log(`PASS ${width}px: pending/outstanding excludes actual Kumar future due by default; To Date 5 November shows 4000; cutoff 15 October excludes it`);
 }
}finally{await call('Fetch.disable');await ev(`localStorage.removeItem('finance_session');localStorage.removeItem('finance_last_activity')`);ws.close()}
