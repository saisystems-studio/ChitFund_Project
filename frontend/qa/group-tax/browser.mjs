// Add / Edit Group: HSN Code & Rate of Tax shown only for groups under Direct / Indirect Expenses
// and Direct / Indirect Income (by the Group Tag's root nature); hidden and saved blank otherwise.
// Same isolated QA setup as qa/party-ledger/browser.mjs (SQLite backend :8765, Vite :5179, Chrome CDP :9239).
// Usage: node qa/group-tax/browser.mjs <user> <pass> [shots dir]
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
const setValue = (selector, value) => evaluate(`(()=>{const e=${selector};const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);
const shot = async name => { if (!SHOTS) return; const { data } = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, 'base64')); };
const login = await (await fetch(`${API}/auth/login/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) })).json();
const api = async path => (await fetch(`${API}${path}`, { headers: { Authorization: `Token ${login.token}` } })).json();
const go = async path => { await call('Page.navigate', { url: `${APP}${path}` }); await sleep(500); await wait(`document.readyState==='complete'`); };
await call('Page.enable'); await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await go('/login');
// Clear any stale session first: a leftover token from an earlier run would 401 and log out
// again right after the new session is stored.
await evaluate(`localStorage.clear()`); await go('/login');
await evaluate(`localStorage.setItem('finance_session', ${JSON.stringify(JSON.stringify(login))}); localStorage.setItem('finance_last_activity', String(Date.now()))`);

// scope: '.group-card' (Add Group) or '.group-modal' (Edit Group)
const fieldsIn = scope => evaluate(`[...document.querySelectorAll('${scope} .group-fields label, ${scope} .group-fields .group-field')].filter(e=>e.offsetParent!==null).map(e=>{const r=e.getBoundingClientRect();return {label:e.querySelector('span')?.textContent.replace('*','').trim(), left:Math.round(r.left), top:Math.round(r.top), width:Math.round(r.width)}})`);
const box = selector => evaluate(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}})()`);
const pickTag = async (scope, name) => {
  await evaluate(`document.querySelector('${scope} .group-fields [role=combobox]').click()`);
  await wait(`document.querySelector('[aria-label="Search options"]')`);
  await setValue(`document.querySelector('[aria-label="Search options"]')`, name);
  await wait(`[...document.querySelectorAll('[role=option]')].some(o=>o.textContent.replace(/^(— )+/,'')===${JSON.stringify(name)})`);
  await evaluate(`[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.replace(/^(— )+/,'')===${JSON.stringify(name)}).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))`);
  await sleep(250);
};
const labels = fields => fields.map(f => f.label);
const checkEligibility = async (scope, sizeOf, startsHidden = true) => {
  const initial = await fieldsIn(scope);
  if (startsHidden) assert.deepEqual(labels(initial), ['Group Name', 'Group'], `${scope}: only Group Name + Group by default`);
  for (const name of ['Direct Expenses', 'Indirect Expenses', 'Direct Income', 'Indirect Income']) {
    await pickTag(scope, name);
    const shown = await fieldsIn(scope);
    assert.deepEqual(labels(shown), ['Group Name', 'Group', 'HSN Code', 'Rate of Tax (ROT)'], `${scope} ${name}: HSN + ROT shown`);
    const [nameField, tag, hsn, rot] = shown;
    assert.equal(nameField.top, tag.top, 'row 1 aligned');
    assert.equal(hsn.top, rot.top, 'HSN and ROT share row 2');
    assert.ok(hsn.top > nameField.top, 'HSN / ROT in the next row');
    assert.deepEqual([hsn.left, hsn.width, rot.left, rot.width], [nameField.left, nameField.width, tag.left, tag.width], 'row 2 columns line up with row 1');
  }
  const withTax = await sizeOf();
  for (const name of ['Sundry Debtors', 'Sundry Creditors', 'Cash-in-Hand', 'Bank Accounts', 'Current Assets', 'Fixed Assets', 'Current Liabilities']) {
    await pickTag(scope, name);
    assert.deepEqual(labels(await fieldsIn(scope)), ['Group Name', 'Group'], `${scope} ${name}: HSN + ROT hidden`);
    assert.equal(await evaluate(`!!document.querySelector('${scope} .group-tax-row')`), false, 'no blank reserved row');
  }
  return withTax;
};

// ---- Add Group ----
await go('/groups');
await wait(`document.querySelector('.group-card .group-fields')`);
const addInitial = await box('.group-card');
await shot('g1-add-default');
await checkEligibility('.group-card', () => box('.group-card'));
assert.deepEqual(await box('.group-card'), addInitial, 'Add Group card back to its size with fields hidden');
// Eligible group with tax values saves them...
await setValue(`document.querySelector('.group-card input[placeholder="Enter group name"]')`, 'Shop Rent Income');
await pickTag('.group-card', 'Indirect Income');
await setValue(`document.querySelector('.group-card .group-tax-row input')`, '997212');
await setValue(`document.querySelector('.group-card .group-tax-row select')`, '18');
await shot('g2-add-eligible');
await evaluate(`document.querySelector('.group-card .group-save').click()`);
await wait(`document.querySelector('.group-card input[placeholder="Enter group name"]').value===''`, 'saved');
// ...a group switched from eligible to non-eligible saves none (hidden values never submitted).
await setValue(`document.querySelector('.group-card input[placeholder="Enter group name"]')`, 'Branch Debtors');
await pickTag('.group-card', 'Direct Expenses');
await setValue(`document.querySelector('.group-card .group-tax-row input')`, '1234');
await setValue(`document.querySelector('.group-card .group-tax-row select')`, '12');
await pickTag('.group-card', 'Sundry Debtors');
await shot('g3-add-hidden');
await evaluate(`document.querySelector('.group-card .group-save').click()`);
await wait(`document.querySelector('.group-card input[placeholder="Enter group name"]').value===''`, 'saved');
const groups = await api('/finance/groups/');
const rent = groups.find(g => g.group_name === 'Shop Rent Income'), branch = groups.find(g => g.group_name === 'Branch Debtors');
assert.deepEqual([rent.hsn_code, rent.rate_of_tax], ['997212', 18], 'eligible group keeps HSN / ROT');
assert.deepEqual([branch.hsn_code, branch.rate_of_tax], ['', 0], 'hidden HSN / ROT not submitted');

// ---- Edit Group (List -> Edit modal) ----
await go('/groups/list');
await wait(`[...document.querySelectorAll('.group-table tbody tr')].some(tr=>tr.textContent.includes('Shop Rent Income'))`);
await evaluate(`[...document.querySelectorAll('.group-table tbody tr')].find(tr=>tr.textContent.includes('Shop Rent Income')).querySelector('[title="Edit"],[aria-label="Edit"]').click()`);
await wait(`document.querySelector('.group-modal .group-tax-row input')?.value==='997212'`, 'Edit shows the saved HSN for an eligible group');
assert.equal(await evaluate(`document.querySelector('.group-modal .group-tax-row select').value`), '18');
const modalWithTax = await box('.group-modal');
await shot('g4-edit-eligible');
await checkEligibility('.group-modal', () => box('.group-modal'), false);
assert.equal((await box('.group-modal')).w, modalWithTax.w, 'Edit modal width never changes');
await shot('g5-edit-hidden');
await evaluate(`document.querySelector('.group-modal .group-save').click()`);
await wait(`!document.querySelector('.group-modal')`, 'edit saved');
const edited = (await api('/finance/groups/')).find(g => g.id === rent.id);
assert.deepEqual([edited.hsn_code, edited.rate_of_tax], ['', 0], 'moved to a non-eligible tag: HSN / ROT cleared');

// ---- Mobile: one column, no overflow ----
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await go('/groups'); await wait(`document.querySelector('.group-card .group-fields')`);
await pickTag('.group-card', 'Direct Income');
assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`), false, 'no horizontal overflow at 390px');
await shot('g6-mobile-eligible');
assert.deepEqual(errors, [], 'no uncaught page errors');
console.log('ALL GROUP TAX CHECKS PASSED');
ws.close();
