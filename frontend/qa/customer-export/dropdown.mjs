import {writeFileSync,mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
const targets=await(await fetch('http://127.0.0.1:9239/json')).json(),ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const jobs=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=jobs.get(m.id);jobs.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}});const call=(method,params={})=>new Promise((resolve,reject)=>{jobs.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};const wait=async s=>{for(let i=0;i<80;i++){if(await ev(`!!(${s})`))return;await new Promise(r=>setTimeout(r,100))}throw Error(s)};const click=t=>ev(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(t)}).click()`);

await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/qa/customer-export/index.html?many'});await wait("document.querySelectorAll('[role=combobox]').length===2 && !document.querySelector('.rpt-loading')");
for(const width of [1440,800,390]){
 await call('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<500});
 for(const index of [0,1]){
  assert.equal(await ev("document.querySelectorAll('[aria-label=\"Search options\"]').length"),0);
  await ev(`document.querySelectorAll('[role=combobox]')[${index}].scrollIntoView({block:'nearest',inline:'nearest'})`);
  await ev(`document.querySelectorAll('[role=combobox]')[${index}].click()`);await wait("document.querySelector('[aria-label=\"Search options\"]')");
  const geometry=await ev(`(()=>{const f=document.querySelectorAll('[role=combobox]')[${index}],s=document.querySelector('[aria-label="Search options"]'),p=s.parentElement.parentElement,r=f.getBoundingClientRect(),b=p.getBoundingClientRect(),o=p.querySelector('[role=option]'),or=o.getBoundingClientRect();return {field:r.toJSON(),panel:b.toJSON(),portaled:p.parentElement===document.body,hit:o.contains(document.elementFromPoint(or.x+or.width/2,or.y+or.height/2)),search:s.getBoundingClientRect().y}})()`);
  assert.ok(geometry.portaled&&geometry.hit);assert.ok(Math.abs(geometry.field.width-geometry.panel.width)<1);assert.ok(Math.abs(geometry.panel.top-geometry.field.bottom-4)<1);assert.ok(geometry.panel.height<=250.1);
  await ev("document.querySelector('[role=listbox]').scrollTop=9999");assert.equal(await ev("document.querySelector('[aria-label=\"Search options\"]').getBoundingClientRect().y"),geometry.search);
  await ev(`(()=>{const s=document.querySelector('[aria-label="Search options"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,${index===0?"'Kumar'":"'CH-0001'"});s.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait("document.querySelectorAll('[role=option]').length===1");
  await ev("document.querySelector('[role=option]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");assert.equal(await ev("document.querySelectorAll('[aria-label=\"Search options\"]').length"),0);
  await ev(`document.querySelectorAll('[role=combobox]')[${index}].click()`);await wait("document.querySelector('[role=listbox]')");await ev("document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");assert.equal(await ev("document.querySelectorAll('[role=listbox]').length"),0);
  await ev("document.querySelector('.rpt-field-customer button[aria-label=\"Clear selection\"]')?.click()");
  console.log('PASS portal anchor, width, clipping, fixed search, filtering/select/outside/clear',width,index);
 }
}
ws.close();
