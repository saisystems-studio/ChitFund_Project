import {writeFileSync,mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
const targets=await(await fetch('http://127.0.0.1:9239/json')).json(),ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const jobs=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=jobs.get(m.id);jobs.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}});const call=(method,params={})=>new Promise((resolve,reject)=>{jobs.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};const wait=async s=>{for(let i=0;i<80;i++){if(await ev(`!!(${s})`))return;await new Promise(r=>setTimeout(r,100))}throw Error(s)};const click=t=>ev(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(t)}).click()`);

await call('Page.navigate',{url:'http://127.0.0.1:5179/chitfund/qa/layout/index.html'});await wait("document.querySelector('select option[value=\"1\"]')");
for(const type of ['1','2','3']){
 await ev(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.text==='Chit'));s.value='${type}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await wait("document.querySelector('.loan-details-grid')");
 for(const width of [1440,800,390]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<500});
  const result=await ev(`(()=>{const g=document.querySelector('.loan-details-grid'),fields=[...g.children];return {cols:getComputedStyle(g).gridTemplateColumns.split(' ').length,overflow:g.scrollWidth>g.clientWidth,fields:fields.map(f=>{const c=f.querySelector('select,input'),r=c.getBoundingClientRect(),l=f.querySelector('span').getBoundingClientRect();return {width:f.getBoundingClientRect().width,height:r.height,y:r.y,labelY:l.y}})}})()`);
  assert.equal(result.cols,width>1024?4:width>600?2:1);assert.equal(result.overflow,false);
  assert.ok(result.fields.every(f=>Math.abs(f.width-result.fields[0].width)<1&&f.height===37));
  if(width===1440){assert.ok(result.fields.every(f=>f.y===result.fields[0].y&&f.labelY===result.fields[0].labelY));if(type==='1')assert.equal(result.fields.length,4)}
  console.log('PASS',type,width,JSON.stringify(result));
 }
}
await call('Browser.close');ws.close();
