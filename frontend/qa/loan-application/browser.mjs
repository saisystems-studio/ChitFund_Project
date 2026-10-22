// Loan Application redesign: one full-height white container, Row 1 Customer | Loan Type only,
// loan-type fields below, Cancel | Reset | Save at the bottom centre, no Resources / KYC.
// Same isolated QA setup as qa/party-ledger/browser.mjs (SQLite backend :8765, Vite :5179,
// Chrome CDP :9239, seeded by qa/party-ledger/seed.py). Usage: node qa/loan-application/browser.mjs <user> <pass> [shots dir]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [USER, PASS, SHOTS] = process.argv.slice(2);
const APP = 'http://localhost:5179/chitfund', API = 'http://127.0.0.1:8765/api';
const targets = await (await fetch('http://127.0.0.1:9239/json')).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let sequence = 0; const pending = new Map(), errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(message.error) : task.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
});
const call = (method, params = {}) => new Promise((res, rej) => { const id = ++sequence; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wait = async (predicate, label = predicate) => { for (let i = 0; i < 100; i++) { if (await evaluate(`!!(${predicate})`)) return; await sleep(100); } throw new Error('Timeout: ' + label); };
const setSelect = (selector, text) => evaluate(`(()=>{const s=${selector};const o=[...s.options].find(o=>o.text.startsWith(${JSON.stringify(text)}));if(!o)throw new Error('no option '+${JSON.stringify(text)});Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
const shot = async name => { if (!SHOTS) return; const { data } = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, 'base64')); };
const login = await (await fetch(`${API}/auth/login/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) })).json();
const api = async (path, init = {}) => (await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Token ${login.token}`, 'Content-Type': 'application/json' } })).json();
const go = async path => { await call('Page.navigate', { url: `${APP}${path}` }); await sleep(600); await wait(`document.readyState==='complete'`); };
await call('Page.enable'); await call('Runtime.enable');
await call('Emulation.setFocusEmulationEnabled', { enabled: true });
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await go('/login');
// Clear any stale session first: a leftover token from an earlier run would 401 and log out
// again right after the new session is stored.
await evaluate(`localStorage.clear()`); await go('/login');
await evaluate(`localStorage.setItem('finance_session', ${JSON.stringify(JSON.stringify(login))}); localStorage.setItem('finance_last_activity', String(Date.now()))`);

const FORM = `document.querySelector('.clean-loan-page > form')`;
const loanType = `[...document.querySelectorAll('.clean-loan-page select')].find(s=>[...s.options].some(o=>o.text==='Chit'))`;
const layout = () => evaluate(`(()=>{const f=${FORM}.getBoundingClientRect(), a=document.querySelector('.clean-loan-page .clean-actions').getBoundingClientRect(), h=document.querySelector('.clean-loan-page .exact-header').getBoundingClientRect();
  const row=[...document.querySelectorAll('.clean-loan-page .loan-party-grid > .exact-field')].map(e=>{const r=e.getBoundingClientRect();return {label:e.querySelector('span').textContent.replace('*','').trim(),left:Math.round(r.left),top:Math.round(r.top),width:Math.round(r.width)}});
  const fields=[...document.querySelectorAll('.clean-loan-page form .exact-field, .clean-loan-page form .collection-plan-field')].filter(e=>e.offsetParent!==null);
  const lastBottom=Math.max(...fields.map(e=>e.getBoundingClientRect().bottom), ...[...document.querySelectorAll('.clean-loan-page form .accordion-content-panel, .clean-loan-page form .loan-accordion-row')].map(e=>e.getBoundingClientRect().bottom));
  const mc=document.querySelector('.main-content'), mcs=getComputedStyle(mc);
  return {mainInner:Math.round(mc.clientWidth-parseFloat(mcs.paddingLeft)-parseFloat(mcs.paddingRight)), vh:innerHeight, overflowX:document.documentElement.scrollWidth>innerWidth, header:Math.round(h.bottom), formTop:Math.round(f.top), formBottom:Math.round(f.bottom), formLeft:Math.round(f.left), formWidth:Math.round(f.width), formCenter:Math.round(f.left+f.width/2),
    actionsTop:Math.round(a.top), actionsBottom:Math.round(a.bottom), actionsCenter:Math.round(a.left+a.width/2), buttons:[...document.querySelectorAll('.clean-loan-page .clean-actions button')].map(b=>b.textContent.trim()),
    buttonsCenter:(()=>{const b=[...document.querySelectorAll('.clean-loan-page .clean-actions button')].map(x=>x.getBoundingClientRect());return Math.round((b[0].left+b[b.length-1].right)/2)})(),
    row, lastFieldBottom:Math.round(lastBottom), text:document.querySelector('.clean-loan-page').innerText, panels:document.querySelectorAll('.clean-loan-page form .clean-panel').length,
    panelBorder:getComputedStyle(document.querySelector('.clean-loan-page form .clean-panel')).borderTopWidth, formBg:getComputedStyle(${FORM}).backgroundColor}})()`);
const removed = ['Resources', 'KYC', 'Document Attachments', 'ID Proof', 'Upload', 'Camera', 'Attached Documents', 'Select a Loan Type to enter'];
const checkShell = (l, label) => {
  for (const word of removed) assert.ok(!l.text.includes(word), `${label}: "${word}" removed`);
  assert.deepEqual(l.row.map(f => f.label), ['Customer', 'Loan Type'], `${label}: Row 1 is Customer | Loan Type`);
  assert.equal(l.row[0].top, l.row[1].top, `${label}: Row 1 aligned`);
  assert.ok(Math.abs(l.row[0].width - l.row[1].width) <= 1, `${label}: equal widths (${l.row[0].width} / ${l.row[1].width})`);
  assert.deepEqual(l.buttons, ['Cancel', 'Reset', 'Save'], `${label}: buttons`);
  assert.ok(Math.abs(l.buttonsCenter - l.formCenter) <= 2, `${label}: buttons centred (${l.buttonsCenter} vs ${l.formCenter})`);
  assert.ok(l.actionsTop >= l.lastFieldBottom, `${label}: buttons never overlap the fields`);
  assert.equal(l.panelBorder, '0px', `${label}: no nested card border`);
  assert.equal(l.formBg, 'rgb(255, 255, 255)', `${label}: white container`);
  assert.equal(l.overflowX, false, `${label}: no horizontal overflow`);
};

// ---- Opens with Customer | Loan Type only; full-height container; buttons at the bottom ----
await go('/loan-application');
await wait(`${FORM}`); await sleep(500);
const base = await layout();
checkShell(base, 'no type');
assert.ok(base.formBottom >= base.vh - 14, `container reaches the viewport bottom (${base.formBottom} of ${base.vh})`);
assert.ok(base.actionsBottom >= base.formBottom - 24, `buttons at the bottom of the container (${base.actionsBottom} / ${base.formBottom})`);
assert.ok(base.actionsTop - base.lastFieldBottom > 300, 'buttons are not directly under the two fields');
assert.ok(base.formWidth >= base.mainInner - 1, `one container spanning the full content width (${base.formWidth} of ${base.mainInner}px)`);
await shot('l1-no-type');

// ---- Loan Type changes: only the inner fields change; nothing jumps ----
const expectFields = { Chit: ['Chit Group', 'Chit Start Date', 'Chit End Date', 'Chit Amount'], Interest: ['Loan Amount', 'Interest Percent'], Mortgage: ['Product Name', 'Quantity', 'Loan Amount', 'Rate of Interest'] };
for (const [name, fields] of Object.entries(expectFields)) {
  await setSelect(loanType, name); await sleep(600);
  const l = await layout();
  checkShell(l, name);
  for (const field of fields) assert.ok(l.text.includes(field), `${name}: shows ${field}`);
  assert.deepEqual([l.header, l.formTop, l.formLeft, l.formWidth, l.formBottom], [base.header, base.formTop, base.formLeft, base.formWidth, base.formBottom], `${name}: container does not move or resize`);
  assert.deepEqual(l.row.map(f => [f.left, f.top, f.width]), base.row.map(f => [f.left, f.top, f.width]), `${name}: Row 1 stays put`);
  assert.equal(l.actionsBottom, base.actionsBottom, `${name}: buttons stay at the bottom`);
  await shot(`l2-${name.toLowerCase()}`);
}

// ---- Long details: page scrolls, buttons follow the content (no overlap); Chit save works ----
await setSelect(loanType, 'Chit'); await sleep(400);
const customerSelect = `[...document.querySelectorAll('.clean-loan-page select')].find(s=>[...s.options].some(o=>o.text==='Select Customer'))`;
await setSelect(customerSelect, 'Kumar');
await setSelect(`[...document.querySelectorAll('.clean-loan-page select')].find(s=>[...s.options].some(o=>o.text.startsWith('Search Chit Group')))`, 'QA Chit');
await sleep(800);
await evaluate(`[...document.querySelectorAll('.clean-loan-page .loan-accordion-toggle')].find(b=>b.textContent.includes('Schedule'))?.click()`); await sleep(600);
await evaluate(`[...document.querySelectorAll('.clean-loan-page .loan-accordion-toggle')].find(b=>b.textContent.includes('Holiday'))?.click()`); await sleep(400);
const long = await layout();
assert.ok(long.actionsTop >= long.lastFieldBottom, 'long content: buttons below the details, not overlapping');
await shot('l3-chit-filled');
const before = (await api('/finance/loans/?page_size=100')).results?.length ?? (await api('/finance/loans/')).length;
await evaluate(`[...document.querySelectorAll('.clean-loan-page .clean-actions button')].find(b=>b.textContent.trim()==='Save').click()`);
await wait(`location.pathname.endsWith('/loan-list')`, 'Chit loan saved -> Loan List');
const loans = (await api('/finance/loans/?page_size=100')).results ?? await api('/finance/loans/');
assert.equal(loans.length, before + 1, 'one new loan saved');

// ---- Edit keeps a Resource saved earlier, though the field is no longer on the form ----
const staff = (await api('/staff/')).results?.[0] ?? (await api('/staff/'))[0];
const target = loans.find(l => (l.loan_type?.name || l.loan_type_name) === 'Chit') || loans[0];
await api(`/finance/loans/${target.id}/`, { method: 'PATCH', body: JSON.stringify({ done_by_staff: staff.id }) });
assert.equal(String((await api(`/finance/loans/${target.id}/`)).done_by_staff), String(staff.id), 'resource stored before edit');
await go(`/loan-application/${target.id}/edit`);
await wait(`${FORM}`); await sleep(1200);
checkShell(await layout(), 'edit');
await evaluate(`[...document.querySelectorAll('.clean-loan-page .clean-actions button')].find(b=>b.textContent.trim()==='Save').click()`);
await wait(`location.pathname.endsWith('/loan-list')`, 'edit saved');
assert.equal(String((await api(`/finance/loans/${target.id}/`)).done_by_staff), String(staff.id), 'edit kept the saved resource');

// ---- Tablet / mobile ----
for (const [w, h] of [[820, 1180], [390, 844]]) {
  await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
  await go('/loan-application'); await wait(`${FORM}`); await sleep(600);
  const l = await layout();
  checkShell(l, `${w}px`);
  assert.ok(l.formBottom >= l.vh - 16, `${w}px: container reaches the bottom (${l.formBottom}/${l.vh})`);
  await shot(`l4-${w}`);
}
assert.deepEqual(errors, [], 'no uncaught page errors');
console.log('ALL LOAN APPLICATION CHECKS PASSED');
ws.close();
