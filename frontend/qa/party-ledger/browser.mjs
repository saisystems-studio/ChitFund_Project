// Party Ledger / Collection Entry / layout end-to-end: real app + real Django API on an isolated
// SQLite database (never SQL Server). Setup (from backend/, PYTHONPATH=frontend/qa/party-ledger, QA_DB=<scratch file>):
//   manage.py migrate --run-syncdb --settings=qa_settings; manage.py seed --settings=qa_settings;
//   create superuser; manage.py shell --settings=qa_settings -c "exec(open('../frontend/qa/party-ledger/seed.py').read())"
//   manage.py runserver 127.0.0.1:8765 --settings=qa_settings; `VITE_API_URL=http://127.0.0.1:8765/api npx vite --port 5179`;
//   headless Chrome with --remote-debugging-port=9239. Usage: node qa/party-ledger/browser.mjs <user> <pass> [shots dir]
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
const evaluate = async expression => { if (process.env.QA_TRACE) console.log("eval", expression.slice(0, 110)); const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wait = async (predicate, label = predicate) => { for (let i = 0; i < 150; i++) { if (await evaluate(`!!(${predicate})`)) return; await sleep(100); } throw new Error('Timeout: ' + label); };
const setValue = (selector, value) => evaluate(`(()=>{const e=${selector};const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);
const click = selector => evaluate(`${selector}.click()`);
const byText = (selector, text) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
const fieldByLabel = (scope, label) => `[...document.querySelectorAll('${scope} label')].find(l=>l.querySelector('span,.entry-label')?.textContent.replace('*','').trim()===${JSON.stringify(label)})`;
const pickDropdown = async (combobox, text) => {
  await click(combobox);
  await wait(`document.querySelector('[aria-label="Search options"]')!==null`);
  await setValue(`document.querySelector('[aria-label="Search options"]')`, text);
  await wait(`[...document.querySelectorAll('[role=option]')].some(o=>o.textContent.includes(${JSON.stringify(text)}))`);
  await evaluate(`[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.includes(${JSON.stringify(text)})).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))`);
};
const shot = async name => { if (!SHOTS) return; const { data } = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, 'base64')); };
const rect = selector => evaluate(`(()=>{const r=${selector}.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),height:Math.round(r.height)}})()`);
const viewport = () => evaluate(`({h:innerHeight,w:innerWidth,overflowX:document.documentElement.scrollWidth>innerWidth})`);
const login = await (await fetch(`${API}/auth/login/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) })).json();
const api = async (path, init = {}) => { const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Token ${login.token}`, 'Content-Type': 'application/json' } }); return r.json(); };
const go = async path => { await call('Page.navigate', { url: `${APP}${path}` }); await sleep(400); await wait(`document.readyState==='complete'`); };
await call('Page.enable'); await call('Runtime.enable');
// Headless pages lack window focus, so focus/blur events would never fire; emulate a focused page.
await call('Emulation.setFocusEmulationEnabled', { enabled: true });
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await go('/login');
// Clear any stale session first: a leftover token from an earlier run would 401 and log out
// again right after the new session is stored.
await evaluate(`localStorage.clear()`); await go('/login');
await evaluate(`localStorage.setItem('finance_session', ${JSON.stringify(JSON.stringify(login))}); localStorage.setItem('finance_last_activity', String(Date.now()))`);

// ---- Task 1 Flow A: Add Ledger -> (automatic) Add Customer -> back to Add Ledger -> Save ----
const ledgerName = `document.querySelector('.ledger-card input[placeholder="Enter ledger name"]')`;
const ledgerGroup = `document.querySelectorAll('.ledger-card .ledger-field')[1].querySelector('[role=combobox]')`;
const ledgerLabels = () => evaluate(`[...document.querySelectorAll('.ledger-card .ledger-field > span:first-child')].map(s=>s.textContent.replace('*','').trim())`);
const onPage = path => evaluate(`location.pathname.endsWith(${JSON.stringify(path)})`);
await go('/ledgers');
await wait(ledgerName);
// A non-party group stays on Add Ledger.
await setValue(ledgerName, 'Sai');
await pickDropdown(ledgerGroup, 'Indirect Income'); await sleep(500);
assert.ok(await onPage('/ledgers'), 'non-party group: no redirect');
// Name filled + Sundry Creditors -> Add Customer opens by itself ...
await pickDropdown(ledgerGroup, 'Sundry Creditors');
await wait(`location.pathname.endsWith('/customers/new')`, 'Sundry Creditors redirects to Add Customer');
await wait(`document.querySelector('.add-customer-form')`);
// ... and Cancel comes back with the draft, creating nothing.
await click(byText('.add-customer-form button', 'Cancel'));
await wait(`location.pathname.endsWith('/ledgers') && ${ledgerName}?.value==='Sai'`, 'Cancel returns with the draft');
assert.equal((await api('/customers/')).filter(c => c.full_name === 'Sai').length, 0, 'Cancel created no customer');
assert.equal((await api('/finance/ledgers/')).filter(l => l.name === 'Sai').length, 0, 'Cancel created no ledger');
await sleep(500);
assert.ok(await onPage('/ledgers'), 'restoring the draft does not redirect again (no loop)');
assert.ok(!(await ledgerLabels()).includes('Collection Type'), 'no Collection Type field');
assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b=>/add customer/i.test(b.textContent))`), false, 'no Add Customer button');
// Group chosen first with an empty name: no redirect; finishing the name opens Add Customer.
await click(byText('.ledger-card button', 'Reset')); await sleep(300);
await pickDropdown(ledgerGroup, 'Sundry Debtors'); await sleep(500);
assert.ok(await onPage('/ledgers'), 'no redirect without a ledger name');
await setValue(ledgerName, 'Sai');
await shot('01-add-ledger-party-group');
await evaluate(`${ledgerName}.focus()`); await evaluate(`${ledgerName}.blur()`);
await wait(`location.pathname.endsWith('/customers/new')`, 'redirect once the name is entered');
await wait(`document.querySelector('.add-customer-form')`);
const nameInput = `[...document.querySelectorAll('.add-customer-form label')].find(l=>l.textContent.trim().startsWith('Customer Name')).querySelector('input')`;
await wait(`${nameInput}.value==='Sai'`, 'Customer Name prefilled from Ledger Name');
const hasGroupField = () => evaluate(`[...document.querySelectorAll('.add-customer-form label')].some(l=>l.textContent.trim().startsWith('Group'))`);
assert.equal(await hasGroupField(), false, 'Group field hidden');
const custField = label => `[...document.querySelectorAll('.add-customer-form label')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)})).querySelector('input,textarea')`;
// A refresh of Add Customer keeps the ledger context.
await call('Page.reload'); await sleep(1200); await wait(`${nameInput}?.value==='Sai'`, 'refresh keeps the prefilled name');
assert.equal(await hasGroupField(), false, 'Group still hidden after refresh');
await setValue(custField('Phone Number'), '9876500002');
await setValue(custField('Email'), 'sai@example.com');
await setValue(custField('Address'), '5 Temple Street');
await setValue(custField('District'), 'Karur');
await setValue(custField('State'), 'Tamil Nadu');
await shot('02-add-customer-from-ledger');
await evaluate(`[...document.querySelectorAll('.add-customer-form button[type=submit]')][0].click()`);
await wait(`location.pathname.endsWith('/ledgers')`, 'back to Add Ledger');
await wait(`${ledgerName}?.value==='Sai'`, 'ledger name restored');
assert.equal(await evaluate(`${ledgerName}.readOnly`), true);
assert.equal(await evaluate(`${ledgerGroup}.value`), 'Sundry Debtors', 'group restored');
assert.match(await evaluate(`document.querySelector('.ledger-linked-note')?.textContent||''`), /Linked to customer Sai/);
// A refresh of Add Ledger here still completes the same linked ledger.
await call('Page.reload'); await sleep(1200); await wait(`document.querySelector('.ledger-linked-note')`, 'refresh keeps the link');
await setValue(`document.querySelector('.ledger-card input[type=number]')`, '1500');
await setValue(`document.querySelector('.ledger-balance-type-select')`, 'CR');
await shot('03-back-on-ledger-linked');
await click(`document.querySelector('.ledger-card .ledger-save')`);
await wait(`${ledgerName}?.value===''`, 'ledger saved and form reset');
const ledgers = await api('/finance/ledgers/');
const sai = ledgers.filter(l => l.name === 'Sai');
assert.equal(sai.length, 1, 'Sai appears once in Ledger List');
assert.equal(Number(sai[0].opening_balance), -1500);
const customers = await api('/customers/');
assert.equal(customers.filter(c => c.full_name === 'Sai').length, 1, 'Sai appears once in Customer List');
assert.equal(customers.find(c => c.full_name === 'Sai').ledger_id, sai[0].id, 'Customer ID <-> Ledger ID');
await go('/ledgers'); await sleep(600);
assert.equal(await evaluate(`${ledgerName}.value`), '', 'a later Add Ledger visit starts empty');
// Direct Add Customer (Masters): Group shown; saving creates the linked ledger with zero opening.
await go('/customers/new'); await wait(`document.querySelector('.add-customer-form')`); await sleep(500);
assert.equal(await hasGroupField(), true, 'direct Add Customer shows Group');
await setValue(nameInput, 'Meena');
await setValue(custField('Phone Number'), '9876500003');
await setValue(custField('Address'), '7 Market Road');
await setValue(custField('District'), 'Karur');
await setValue(custField('State'), 'Tamil Nadu');
await pickDropdown(`[...document.querySelectorAll('.add-customer-form label')].find(l=>l.textContent.trim().startsWith('Group')).querySelector('[role=combobox]')`, 'Sundry Debtors');
await evaluate(`[...document.querySelectorAll('.add-customer-form button[type=submit]')][0].click()`);
await wait(`${nameInput}.value===''`, 'direct customer saved');
assert.ok(await onPage('/customers/new'), 'direct Add Customer stays on Add Customer');
const meena = (await api('/finance/ledgers/')).filter(l => l.name === 'Meena');
assert.equal(meena.length, 1); assert.equal(Number(meena[0].opening_balance), 0);
assert.equal((await api('/customers/')).find(c => c.full_name === 'Meena').ledger_id, meena[0].id);
console.log('Flow A + direct Add Customer ok: Sai ledger', sai[0].id, '/ Meena ledger', meena[0].id);

// ---- Task 4/5: Collection Entry, Scenario A (Kumar's loan, partial on the 3rd due) ----
await go('/collection-entry');
await wait(`!!document.querySelector('.ce-v2 .ce-v2-grid')`);
await sleep(600);
const labels = await evaluate(`[...document.querySelectorAll('.ce-v2 .ce-v2-grid > label .entry-label')].map(e=>e.textContent.replace('*','').trim())`);
assert.deepEqual(labels.slice(0, 6), ['Ledger', 'Accounts', 'Loan Plan', 'Collection Amount', 'Payment Mode', 'Resources']);
const card0 = await rect(`document.querySelector('.ce-v2 .collection-entry-card')`), head0 = await rect(`document.querySelector('.ce-v2 .collection-entry-heading')`), vp = await viewport();
assert.ok(Math.abs(card0.bottom - (vp.h - 12)) <= 2, `white card reaches the viewport bottom (${card0.bottom} vs ${vp.h})`);
await shot('04-collection-entry-empty');
const ledgerOptions = await evaluate(`(document.querySelector('.ce-v2 .entry-picker-button').click(), [...document.querySelectorAll('.ce-v2 .entry-customer-options button')].map(b=>b.textContent))`);
assert.ok(!ledgerOptions.includes('CASH') && !ledgerOptions.includes('KVB'), 'Cash/Bank excluded from Ledger');
await click(byText('.ce-v2 .entry-customer-options button', 'Kumar'));
await wait(`document.querySelector('.ce-v2 .ce-v2-grid select')?.closest('label') && [...document.querySelectorAll('.ce-v2 select')].some(s=>s.value!=='' && s.options[s.selectedIndex].text.includes('Chit'))`, 'Kumar loan plan auto-selected');
await setValue(`${fieldByLabel('.ce-v2', 'Accounts')}.querySelector('select')`, String(ledgers.find(l => l.name === 'CASH').id));
await wait(`${fieldByLabel('.ce-v2', 'Payment Mode')}.querySelector('select').value==='Cash'`, 'Cash account -> Payment Mode Cash');
const accountTexts = await evaluate(`[...${fieldByLabel('.ce-v2', 'Accounts')}.querySelector('select').options].map(o=>o.text)`);
assert.deepEqual(accountTexts, ['Select Account', 'CASH', 'KVB'], 'Accounts show the ledger name only');
await click(byText('.ce-v2 button', 'View Statement'));
await wait(`!!document.querySelector('.ce-v2-dialog')`);
const statementHead = await evaluate(`[...document.querySelectorAll('.ce-v2-table th')].map(t=>t.textContent)`);
assert.deepEqual(statementHead, ['Select', 'Inst', 'Due Date', 'Due Amount', 'Previously Collected', 'Pending', 'Allocate']);
await evaluate(`document.querySelectorAll('.ce-v2-table tbody input[type=checkbox]')[0].click()`); // untick 1st
await evaluate(`document.querySelectorAll('.ce-v2-table tbody input[type=checkbox]')[2].click()`); // tick 3rd
await setValue(`document.querySelectorAll('.ce-v2-table tbody input[type=number]')[2]`, '4000');
await wait(`document.querySelector('.ce-v2-dialog-totals .ok')?.textContent.includes('0.00')`, 'allocated equals amount');
await shot('05-view-statement-partial');
await click(byText('.ce-v2-dialog button', 'Done'));
assert.equal(await evaluate(`${fieldByLabel('.ce-v2', 'Collection Amount')}.querySelector('input').value`), '4000.00');
await pickDropdown(`${fieldByLabel('.ce-v2', 'Resources')}.querySelector('[role=combobox]')`, 'Ravi');
await click(byText('.ce-v2 button', 'Save'));
await wait(`!!document.querySelector('.save-confirm-modal, [role=dialog]') && document.body.innerText.includes('Collection Saved Successfully')`, 'receipt modal');
const loan = (await api('/finance/loans/?page_size=100')).results?.[0] ?? (await api('/finance/loans/'))[0];
const paid = Object.fromEntries(loan.installments.map(i => [i.installment_number, Number(i.paid_amount)]));
assert.deepEqual(paid, { 1: 0, 2: 0, 3: 4000 }, 'only the chosen installment is collected');
console.log('Scenario A ok:', paid);
await evaluate(`[...document.querySelectorAll('button')].find(b=>/close|done|×/i.test(b.textContent||b.getAttribute('aria-label')||''))?.click()`);

// ---- Scenario B: general ledger without loans (Rent) ----
await go('/collection-entry');
await wait(`!!document.querySelector('.ce-v2 .entry-picker-button')`); await sleep(600);
await click(`document.querySelector('.ce-v2 .entry-picker-button')`);
await click(byText('.ce-v2 .entry-customer-options button', 'Rent'));
await wait(`${fieldByLabel('.ce-v2', 'Loan Plan')}?.classList.contains('ce-v2-disabled') && ${fieldByLabel('.ce-v2', 'Loan Plan')}.querySelector('select').disabled`, 'Loan Plan visible but disabled');
const card1 = await rect(`document.querySelector('.ce-v2 .collection-entry-card')`), head1 = await rect(`document.querySelector('.ce-v2 .collection-entry-heading')`);
await setValue(`${fieldByLabel('.ce-v2', 'Accounts')}.querySelector('select')`, String(ledgers.find(l => l.name === 'KVB').id));
await wait(`${fieldByLabel('.ce-v2', 'Payment Mode')}.querySelector('select').options.length>1`);
const bankModes = await evaluate(`[...${fieldByLabel('.ce-v2', 'Payment Mode')}.querySelector('select').options].map(o=>o.value).filter(Boolean)`);
assert.ok(!bankModes.includes('Cash') && bankModes.includes('NEFT'), 'bank account offers bank modes only');
await setValue(`${fieldByLabel('.ce-v2', 'Payment Mode')}.querySelector('select')`, 'Cheque');
await wait(`!!${fieldByLabel('.ce-v2', 'Cheque Number')}`);
const card2 = await rect(`document.querySelector('.ce-v2 .collection-entry-card')`), head2 = await rect(`document.querySelector('.ce-v2 .collection-entry-heading')`), notes2 = await rect(`document.querySelector('.ce-v2 .entry-notes')`);
await setValue(`${fieldByLabel('.ce-v2', 'Payment Mode')}.querySelector('select')`, 'NEFT');
await wait(`!${fieldByLabel('.ce-v2', 'Cheque Number')}`);
const notes3 = await rect(`document.querySelector('.ce-v2 .entry-notes')`);
assert.deepEqual([head0.top, head1.top, head2.top], [head0.top, head0.top, head0.top], 'header never moves');
assert.deepEqual([card1.top, card1.bottom, card2.top, card2.bottom], [card0.top, card0.bottom, card0.top, card0.bottom], 'white container stable while fields change');
assert.equal(notes2.top, notes3.top, 'Notes row does not move when Cheque fields appear/disappear');
await setValue(`${fieldByLabel('.ce-v2', 'Collection Amount')}.querySelector('input')`, '2500');
await setValue(`${fieldByLabel('.ce-v2', 'UTR / Transaction Reference Number')}.querySelector('input')`, 'UTR778');
await setValue(`${fieldByLabel('.ce-v2', 'Bank Name')}.querySelector('input')`, 'KVB');
await shot('06-scenario-b-rent');
await click(byText('.ce-v2 button', 'Save'));
await wait(`${fieldByLabel('.ce-v2', 'Collection Amount')}.querySelector('input').value===''`, 'Rent collection saved and reset');
const rentReceipts = (await api('/finance/party-collections/')).filter(r => r.party_name === 'Rent');
assert.equal(rentReceipts.length, 1); assert.equal(Number(rentReceipts[0].amount), 2500); assert.equal(rentReceipts[0].account_name, 'KVB');
console.log('Scenario B ok:', rentReceipts[0].voucher_no);

// ---- Party ledger in Existing Collection hands over to Party Collection ----
await click(`document.querySelector('.ce-v2 .entry-picker-button')`);
await click(byText('.ce-v2 .entry-customer-options button', 'Party A'));
await wait(`!!${byText('.ce-v2 button', 'Open in Party Collection')}`);
await click(byText('.ce-v2 button', 'Open in Party Collection'));
await wait(`document.querySelector('.party-collection-page')?.closest('[hidden]')===null && document.querySelector('.party-collection-page .pc-type-badge')?.textContent==='Due-wise Collection'`, 'Party Collection tab with Party A selected');
assert.equal(await evaluate(`[...document.querySelectorAll('.party-collection-page label .entry-label')].some(e=>e.textContent.trim()==='Resources')`), true);
await shot('07-party-collection-handover');

// ---- Task 3: Loan Application stays put when Loan Type changes ----
await go('/loan-application');
await wait(`!!document.querySelector('.clean-loan-page .clean-panel')`); await sleep(500);
const lh0 = await rect(`document.querySelector('.clean-loan-page .exact-header')`), lp0 = await rect(`document.querySelector('.clean-loan-page .clean-panel')`), la0 = await rect(`document.querySelector('.clean-loan-page .clean-actions')`);
await shot('08-loan-no-type');
const typeSelect = `[...document.querySelectorAll('.clean-loan-page select')].find(s=>[...s.options].some(o=>o.text==='Chit'))`;
for (const name of ['Chit', 'Interest', 'Mortgage']) {
  await setValue(typeSelect, await evaluate(`[...${typeSelect}.options].find(o=>o.text===${JSON.stringify(name)}).value`));
  await sleep(500);
  const h = await rect(`document.querySelector('.clean-loan-page .exact-header')`), p = await rect(`document.querySelector('.clean-loan-page .clean-panel')`);
  assert.equal(h.top, lh0.top, `${name}: header did not move`);
  assert.equal(p.top, lp0.top, `${name}: Loan Details panel did not move`);
  await shot(`09-loan-${name.toLowerCase()}`);
}
assert.ok(la0.bottom >= (await viewport()).h - 60, `no-type Loan Application fills the viewport (actions at ${la0.bottom})`);
assert.equal((await viewport()).overflowX, false, 'no horizontal overflow');

// ---- Payment Entry: full height, Resources label ----
await go('/payment-entry');
await wait(`!!document.querySelector('.payment-entry-page .collection-entry-card')`); await sleep(500);
const pe = await rect(`document.querySelector('.payment-entry-page .collection-entry-card')`);
assert.ok(pe.bottom >= (await viewport()).h - 24, `Payment Entry card reaches the bottom (${pe.bottom})`);
assert.equal(await evaluate(`document.body.innerText.includes('Salesman')`), false);
await shot('10-payment-entry');

// ---- Task 14 / 15: HSN & ROT only for Income/Expense groups; one Cash in Hand ledger ----
await go('/ledgers');
await wait(`document.querySelector('.ledger-card input[placeholder="Enter ledger name"]')`);
const groupBox = `document.querySelectorAll('.ledger-card .ledger-field')[1].querySelector('[role=combobox]')`;
const hasHsn = () => evaluate(`[...document.querySelectorAll('.ledger-card .ledger-field > span:first-child')].some(s=>s.textContent.startsWith('HSN Code'))`);
await pickDropdown(groupBox, 'Indirect Income'); await sleep(300);
assert.equal(await hasHsn(), true, 'HSN/ROT shown for Indirect Income');
await pickDropdown(groupBox, 'Sundry Creditors'); await sleep(300);
assert.equal(await hasHsn(), false, 'HSN/ROT hidden for Sundry Creditors');
await pickDropdown(groupBox, 'Bank Accounts'); await sleep(300);
assert.equal(await hasHsn(), false, 'HSN/ROT hidden for Bank Accounts');
await setValue(`document.querySelector('.ledger-card input[placeholder="Enter ledger name"]')`, 'Petty Cash');
await pickDropdown(groupBox, 'Cash-in-Hand'); await sleep(300);
await click(`document.querySelector('.ledger-card .ledger-save')`); await sleep(800);
assert.equal((await api('/finance/ledgers/')).filter(l => l.group === 'Cash-in-Hand').length, 1, 'second Cash in Hand ledger blocked');
const cashApi = await fetch(`${API}/finance/ledgers/`, { method: 'POST', headers: { Authorization: `Token ${login.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Cash 2', group: 'Cash-in-Hand' }) });
assert.equal(cashApi.status, 400, 'backend blocks a second Cash in Hand ledger');
console.log('HSN/ROT + single cash ok');

// ---- Task 10: Journal Entry / List render; Bank Cr 5,000 / Kumar Dr 5,000 posts both ledgers ----
const kumarLedger = ledgers.find(l => l.name === 'Kumar'), kvb = ledgers.find(l => l.name === 'KVB');
await go('/journal-entry');
await wait(`document.querySelector('.jv-voucher')?.value.startsWith('JV-')`, 'Add Journal fetches the next voucher number');
const previewNo = await evaluate(`document.querySelector('.jv-voucher').value`);
await setValue(`document.querySelector('select[aria-label="Ledger Name (Cr)"]')`, String(kvb.id));
await setValue(`document.querySelector('input[aria-label="Credit Amount"]')`, '5000');
await setValue(`document.querySelector('select[aria-label="Ledger Name (Dr)"]')`, String(kumarLedger.id));
await setValue(`document.querySelector('input[aria-label="Debit Amount"]')`, '4999');
await wait(`document.querySelector('.jv-unbalanced')`, 'Unbalanced status shown');
await setValue(`document.querySelector('input[aria-label="Debit Amount"]')`, '5000');
await wait(`document.querySelector('.jv-balanced')`, 'Balanced status shown');
await setValue(`document.querySelector('.jv-narration textarea')`, 'QA adjustment');
await shot('13-journal-entry');
await click(byText('.jv-actions button', 'Save Journal'));
await wait(`document.querySelector('input[aria-label="Credit Amount"]')?.value===''`, 'journal saved and form reset');
const jv = (await api('/finance/journal-vouchers/')).results.find(v => v.narration === 'QA adjustment');
assert.equal(jv.voucher_no, previewNo, 'saved with the previewed voucher number');
assert.equal(Number(jv.total), 5000);
await go('/journal-list'); await wait(`document.body.innerText.includes(${JSON.stringify(jv.voucher_no)})`, 'journal in Journal List');
for (const ledger of [kumarLedger, kvb]) {
  const statement = await api(`/finance/reports/ledger/?type=${ledger === kvb ? 'bank' : 'ledger'}&ledger=${ledger.id}`);
  assert.ok(JSON.stringify(statement).includes(jv.voucher_no), `journal posted to ${ledger.name}`);
}

console.log('Journal ok:', jv.voucher_no);

// ---- Task 2: Customer-wise Report keeps its name and shows the linked ledger postings ----
await go('/reports/customer');
await wait(`document.body.innerText.includes('Customer-wise Report')`, 'report title unchanged');
const cw = await api(`/finance/reports/customer-wise/?customer=${kumarLedger.customer}`);
const kinds = cw.results[0].rows.map(r => r.voucher_type);
assert.ok(kinds.includes('Receipt') && kinds.includes('Journal'), `Kumar statement has receipts and the journal (${kinds})`);
console.log('Customer-wise Report ok:', kinds.join(', '));

// ---- Task 12: Today Report Payment Mode is Cash / Bank only ----
const today = await api(`/finance/reports/today/`);
assert.ok(today.rows.length >= 2);
assert.ok(today.rows.filter(r => r.transaction_type !== 'Loan').every(r => ['Cash', 'Bank'].includes(r.account_type)), 'Cash/Bank category only');
console.log('Today Report ok:', today.rows.map(r => `${r.transaction_type}:${r.account_type}`).join(', '));

// ---- Mobile width: no horizontal overflow on the entry pages ----
await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
for (const path of ['/collection-entry', '/payment-entry', '/loan-application', '/ledgers']) {
  await go(path); await sleep(700);
  assert.equal((await viewport()).overflowX, false, `${path}: no horizontal overflow at 390px`);
}
await shot('11-mobile-ledgers');
await call('Emulation.setDeviceMetricsOverride', { width: 820, height: 1180, deviceScaleFactor: 1, mobile: false });
await go('/collection-entry'); await sleep(700);
assert.equal((await viewport()).overflowX, false, 'tablet: no horizontal overflow');
await shot('12-tablet-collection');
assert.deepEqual(errors, [], 'no uncaught page errors');
console.log('ALL BROWSER CHECKS PASSED');
ws.close();
