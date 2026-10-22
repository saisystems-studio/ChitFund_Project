// Run with Vite on :5179 and an isolated Chrome CDP session on :9239.
// All API responses are mocked; no backend data is read or changed.
// Checks the real Loan Application component and complete shared stylesheet cascade.
import assert from 'node:assert/strict';
const targets=await(await fetch('http://127.0.0.1:9239/json')).json();
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let n=0;const pending=new Map();
const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}))});
ws.onmessage=async e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result)}if(m.method==='Fetch.requestPaused'){
 const {requestId,request}=m.params;const u=request.url;let data=[];
 if(u.includes('loan-types/'))data=['Chit','Interest','Mortgage'].map((name,i)=>({id:i+1,name,is_active:true,allowed_installment_ids:[1]}));
 else if(u.includes('loan-installments/'))data=[{id:1,name:'Monthly'}];
 else if(u.includes('/customers/'))data=[{id:1,full_name:'QA Customer'}];
 else if(u.includes('application-date'))data={application_date:'2026-10-15'};
 else if(u.includes('auth/me'))data={id:1,username:'layout-qa',is_admin:true};
 await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
}};
const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await call('Fetch.enable',{patterns:[{urlPattern:'*/api/*'}]});
 await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/login'});await pause(1000);
 await ev(`localStorage.setItem('finance_session',JSON.stringify({token:'isolated-ui-test',user:{id:1,username:'QA',is_admin:true}}));localStorage.setItem('finance_last_activity',String(Date.now()))`);
 await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/loan-application'});await pause(1800);
 for(const width of [1440,390]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await pause(300);
  let baseline;
  for(const type of ['', '1','2','3']){
   await ev(`(()=>{const s=document.querySelector('.loan-party-grid > label:nth-child(2) select');if(!s)throw Error(document.body.innerText.slice(0,500));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,${JSON.stringify(type)});s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await pause(200);
   const r=await ev(`(()=>{const q=s=>document.querySelector(s),rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom}};const row=q('.loan-party-grid'),form=q('.clean-loan-page > form'),panel=q('.clean-panel');return {rowBg:getComputedStyle(row).backgroundImage,panelBg:getComputedStyle(panel).backgroundColor,form:rect(form),footer:rect(q('.clean-actions')),fields:[...row.children].map(e=>({label:rect(e.firstElementChild),select:rect(e.querySelector('select')),bg:getComputedStyle(e).backgroundImage})),plus:rect(q('.loan-customer-select button')),text:panel.innerText,scroll:getComputedStyle(panel).overflowY,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
   assert.equal(r.rowBg,'none');assert.equal(r.panelBg,'rgb(255, 255, 255)');assert.equal(r.overflow,false);assert.equal(r.scroll,'auto');
   for(const f of r.fields){assert.ok(f.label.b<=f.select.y);assert.equal(f.bg,'none');assert.equal(f.select.h,37)}
   assert.equal(r.plus.y,r.fields[0].select.y);assert.equal(r.plus.h,37);
   if(width>600){assert.equal(r.fields[0].select.y,r.fields[1].select.y);assert.ok(Math.abs(r.fields[0].label.w-r.fields[1].label.w)<1)}
   else assert.ok(r.fields[1].label.y>=r.fields[0].select.b);
   if(!baseline)baseline=r.form;assert.ok(Math.abs(r.form.h-baseline.h)<1);assert.ok(Math.abs(r.form.y-baseline.y)<1);assert.ok(r.footer.b<=900);assert.ok(Math.abs(r.footer.b-r.form.b)<25,JSON.stringify(r));
   assert.ok(!/Resources|KYC|Attached Documents/.test(r.text));
   if(type==='1')assert.ok(r.text.includes('Chit Group'));if(type==='2')assert.ok(r.text.includes('Interest Percent'));if(type==='3')assert.ok(r.text.includes('Product Name'));
   console.log(`PASS width=${width}, type=${type||'none'}, white row, aligned fields, stable container, bottom footer`);
  }
  await ev(`(()=>{let e=document.createElement('div');e.style.height='1600px';document.querySelector('.clean-panel').append(e)})()`);
  assert.ok(await ev(`(()=>{let p=document.querySelector('.clean-panel');p.scrollTop=500;return p.scrollTop>0&&document.querySelector('.clean-actions').getBoundingClientRect().bottom<=900})()`));
 }
}finally{await call('Fetch.disable');await ev(`localStorage.removeItem('finance_session');localStorage.removeItem('finance_last_activity')`);ws.close()}

