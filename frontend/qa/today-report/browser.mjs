// Today Report end-to-end: real app + real Django API on an isolated SQLite database seeded by
// scratchpad seed.py through the real save endpoints (loan create, collect, payment entry).
// Needs: backend on :8765 (QA settings), `VITE_API_URL=http://127.0.0.1:8765/api npx vite --port 5179`,
// headless Chrome with --remote-debugging-port=9239. Usage: node qa/today-report/browser.mjs <today ISO> <user> <pass>
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
const [TODAY, USER, PASS] = process.argv.slice(2);
const day = offset => { const d = new Date(`${TODAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const directory = mkdtempSync(resolve('../docs/today-report-qa-'));
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
const wait = async (predicate, label = predicate) => { for (let i = 0; i < 150; i++) { if (await evaluate(predicate)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Timeout: ' + label); };
const settle = () => wait(`!document.querySelector('.rpt-loading')`).then(() => new Promise(r => setTimeout(r, 250))).then(() => wait(`!document.querySelector('.rpt-loading')`));
const setValue = (selector, value) => evaluate(`(()=>{const e=${selector};const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);
const field = label => `[...document.querySelectorAll('.today-report-page label.rpt-field')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)}))`;
const grid = () => evaluate(`({rows:[...document.querySelectorAll('.today-report-page tbody tr:not(.rpt-empty-row)')].map(tr=>[...tr.cells].map(td=>td.textContent.trim())), totals:[...document.querySelectorAll('.today-report-page tfoot tr')].map(tr=>[...tr.cells].slice(0,2).map(td=>td.textContent.trim())), empty:document.querySelector('.today-report-page .rpt-empty-row')?.innerText||''})`);
const exportDisabled = () => evaluate(`[...document.querySelectorAll('.today-report-page button')].find(b=>b.textContent.trim()==='Export').disabled`);
const loanNos = view => view.rows.map(r => r[4]);
const types = view => view.rows.map(r => r[2]);
const amount = text => Number(String(text).replace(/[^0-9.]/g, ''));
const chooseLoan = async text => {
  await evaluate(`${field('Loan Number')}.querySelector('[role=combobox]').click()`);
  await wait(`document.querySelector('[aria-label="Search options"]')!==null`);
  await setValue(`document.querySelector('[aria-label="Search options"]')`, text);
  await wait(`[...document.querySelectorAll('[role=option]')].some(o=>o.textContent.startsWith(${JSON.stringify(text)}))`);
  await evaluate(`[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.startsWith(${JSON.stringify(text)})).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
  await settle();
};
const download = async (label, ext) => {
  const before = new Set(readdirSync(directory));
  await evaluate(`[...document.querySelectorAll('.today-report-page button')].find(b=>b.textContent.trim()==='Export').click()`);
  await wait(`document.querySelector('[role=menuitem]')!==null`);
  await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  for (let i = 0; i < 100; i++) {
    const added = readdirSync(directory).filter(f => !before.has(f) && f.endsWith(ext));
    if (added.length) { await new Promise(r => setTimeout(r, 400)); return resolve(directory, added[0]); }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('No download for ' + label);
};
const verifyExports = async (name, view) => {
  const pdfPath = await download('Download PDF', '.pdf'), pdf = readFileSync(pdfPath).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-') && pdf.includes('%%EOF'), name + ': valid PDF');
  for (const loanNo of loanNos(view).filter(n => n !== '—')) assert.ok(pdf.includes(`(${loanNo})`), name + ': PDF contains ' + loanNo);
  const xlsxPath = await download('Download Excel', '.xlsx');
  const book = XLSX.read(readFileSync(xlsxPath));
  const sheet = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: '', raw: true });
  const body = sheet.filter(r => typeof r[0] === 'number');
  assert.deepEqual(body.map(r => [r[2], r[4], Number(r[7])]), view.rows.map(r => [r[2], r[4], amount(r[6])]), name + ': XLSX rows == grid (type, loan no, amount)');
  assert.ok(!sheet.flat().some(v => /^(Loans|Receipts|Payments) \(/i.test(String(v))), name + ': XLSX has no subtotal rows');
  assert.equal(sheet.length, sheet.findIndex(r => r[0] === 'S.No') + 1 + view.rows.length, name + ': XLSX ends with the last transaction row');
  assert.ok(!/\((Loans|Receipts|Payments) \(\d+\)/i.test(pdf), name + ': PDF has no subtotal rows');
  assert.ok(String(sheet[0][0]).toUpperCase().includes('TODAY REPORT') && sheet.flat().some(v => String(v).startsWith('Period:')), name + ': XLSX title + period line');
  return `${pdfPath.split(/[\\/]/).pop()} + ${xlsxPath.split(/[\\/]/).pop()}`;
};

await call('Runtime.enable');
await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: 'http://127.0.0.1:5179/chitfund/login' });
await wait(`document.readyState==='complete'`);
await evaluate('localStorage.clear()');  // always sign in through the real login form
await call('Page.navigate', { url: 'http://127.0.0.1:5179/chitfund/login' });
await wait(`document.querySelectorAll('input').length>=2`);
await setValue(`document.querySelectorAll('input')[0]`, USER);
await setValue(`document.querySelectorAll('input')[1]`, PASS);
await evaluate(`document.querySelector('form').requestSubmit()`);
await wait(`document.querySelector('nav[aria-label="Main navigation"]')!==null`, 'login');

// Open through the sidebar: Reports -> General Reports -> Today Report.
const nav = `document.querySelector('nav[aria-label="Main navigation"]')`;
await evaluate(`[...${nav}.querySelectorAll('button')].find(b=>b.textContent.toUpperCase().includes('REPORTS')).click()`);
await wait(`[...${nav}.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('General Reports'))`);
if (!(await evaluate(`[...${nav}.querySelectorAll('a')].some(a=>a.textContent.trim()==='Today Report')`))) await evaluate(`[...${nav}.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('General Reports')).click()`);
await wait(`[...${nav}.querySelectorAll('a')].some(a=>a.textContent.trim()==='Today Report')`, 'General Reports expanded');
await evaluate(`[...${nav}.querySelectorAll('a')].find(a=>a.textContent.trim()==='Today Report').click()`);
await wait(`location.pathname==='/chitfund/today-collection' && !!document.querySelector('.today-report-page')`, 'Today Report page');
await settle();
const results = [];

// Today (default): 3 loans, 1 receipt, 1 payment — in date/type order, each once.
assert.equal(await evaluate(`${field('Period')}.querySelector('select').value`), 'Today');
let view = await grid();
assert.deepEqual(await evaluate(`[...document.querySelectorAll('.today-report-page thead th')].map(th=>th.textContent.trim())`), ['S.No', 'Date', 'Transaction Type', 'Loan Type', 'Loan Number', 'Customer / Particulars', 'Amount', 'Documents']);
assert.deepEqual(types(view), ['Loan', 'Loan', 'Loan', 'Receipt', 'Payment']);
assert.deepEqual(view.rows.map(r => r[3]), ['Interest', 'Chit', 'Interest', 'Mortgage', 'Chit', '—'].slice(1));
assert.deepEqual(loanNos(view), ['CH-0001', 'IN-0002', 'M-0001', 'CH-0001', '—']);
assert.deepEqual(view.rows.map(r => amount(r[6])), [100, 25000, 5000, 120, 75.5]);
assert.ok(view.rows[4][5].includes('Office Rent') && view.rows[4][5].includes('PV-000001'), 'payment row without loan shows ledger + voucher');
assert.ok(view.rows[3][5].includes('Kumar') && view.rows[3][5].includes('RV-000002'), 'receipt particulars');
assert.deepEqual(view.totals, [], 'no subtotal rows on screen');
assert.ok(!/(Loans|Receipts|Payments) \(\d+\)/i.test(await evaluate(`document.querySelector('.today-report-page table').innerText`)), 'no Loans/Receipts/Payments subtotal text on screen');
assert.equal(await exportDisabled(), false);
results.push(['Today (default)', view.rows.length, view.rows.map(r => r[2]).join(','), await verifyExports('today', view)]);

// Loan Type = Interest: only Interest-linked rows; payments (no loan) drop out.
await setValue(`${field('Loan Type')}.querySelector('select')`, 'Interest'); await settle();
view = await grid();
assert.deepEqual(loanNos(view), ['IN-0002']);
results.push(['Loan Type = Interest', view.rows.length, view.rows.map(r => r[2]).join(','), '']);
await setValue(`${field('Loan Type')}.querySelector('select')`, 'All'); await settle();

// Loan Number = CH-0001 (searched inside the dropdown): its loan + its receipt.
await chooseLoan('CH-0001');
view = await grid();
assert.deepEqual(view.rows.map(r => [r[2], r[4]]), [['Loan', 'CH-0001'], ['Receipt', 'CH-0001']]);
results.push(['Loan Number = CH-0001', view.rows.length, view.rows.map(r => r[2]).join(','), await verifyExports('loan', view)]);
// Switching Loan Type to one the loan doesn't belong to clears the incompatible Loan Number.
await setValue(`${field('Loan Type')}.querySelector('select')`, 'Interest'); await settle();
assert.equal(await evaluate(`${field('Loan Number')}.querySelector('[role=combobox]').value`), '');
assert.deepEqual(loanNos(await grid()), ['IN-0002']);
await setValue(`${field('Loan Type')}.querySelector('select')`, 'All'); await settle();
assert.equal((await grid()).rows.length, 5, 'All loans again incl. payment');

// Periods.
const periodCase = async (label, expected, exportIt = false) => {
  await setValue(`${field('Period')}.querySelector('select')`, label); await settle();
  const v = await grid();
  assert.deepEqual(v.rows.map(r => `${r[2]}:${r[4]}`), expected, label);
  results.push([`Period = ${label}`, v.rows.length, v.rows.map(r => r[2]).join(','), exportIt ? await verifyExports(label, v) : '']);
  return v;
};
const todaysFive = ['Loan:CH-0001', 'Loan:IN-0002', 'Loan:M-0001', 'Receipt:CH-0001', 'Payment:—'];
// Seed: IN-0001 loan on -7, its receipt on -3; CH-0002 loan on -10; Electricity payment on -9.
const weekday = new Date(`${TODAY}T00:00:00Z`).getUTCDay(), monday = -((weekday + 6) % 7);
const inRange = (offset, from, to) => offset >= from && offset <= to;
const events = [[-10, 'Loan:CH-0002'], [-9, 'Payment:—'], [-7, 'Loan:IN-0001'], [-3, 'Receipt:IN-0001']];
const expectFor = (from, to) => [...events.filter(([o]) => inRange(o, from, to)).map(([, e]) => e), ...(inRange(0, from, to) ? todaysFive : [])];
await periodCase('This Week', expectFor(monday, monday + 6));
await periodCase('Past Week', expectFor(monday - 7, monday - 1), true);
const dom = Number(TODAY.slice(8, 10));
const monthView = await periodCase('This Month', expectFor(1 - dom, 31 - dom));
assert.equal(monthView.rows.filter(r => r[2] === 'Receipt').length, expectFor(1 - dom, 31 - dom).filter(e => e.startsWith('Receipt')).length, 'only actual receipts, none from schedules');

// Custom Range: loan day and later collection day of the example are separate.
await setValue(`${field('Period')}.querySelector('select')`, 'Custom Range');
await wait(`!!${field('From Date')} && !!${field('To Date')}`);
await setValue(`${field('From Date')}.querySelector('input')`, day(-7)); await new Promise(r => setTimeout(r, 300));
assert.equal(await exportDisabled(), true, 'export disabled until both dates are set');
assert.ok((await evaluate(`document.querySelector('.today-report-page .rpt-error')?.textContent||''`)).includes('Select both From and To dates'));
await setValue(`${field('To Date')}.querySelector('input')`, day(-7)); await settle();
view = await grid();
assert.deepEqual(view.rows.map(r => [r[2], r[4], amount(r[6])]), [['Loan', 'IN-0001', 50000]]);
results.push([`Custom ${day(-7)}`, 1, view.rows.map(r => r[2]).join(','), await verifyExports('custom-loan-day', view)]);
await setValue(`${field('From Date')}.querySelector('input')`, day(-3));
await setValue(`${field('To Date')}.querySelector('input')`, day(-3)); await settle();
view = await grid();
assert.deepEqual(view.rows.map(r => [r[2], r[4], amount(r[6])]), [['Receipt', 'IN-0001', 500]]);
results.push([`Custom ${day(-3)}`, 1, view.rows.map(r => r[2]).join(','), '']);
await setValue(`${field('From Date')}.querySelector('input')`, day(-20));
await setValue(`${field('To Date')}.querySelector('input')`, day(-15)); await settle();
view = await grid();
assert.equal(view.rows.length, 0); assert.ok(view.empty.includes('No transactions found'));
assert.deepEqual(view.totals, []);
results.push(['Custom empty range', 0, 'empty state shown', '']);

assert.deepEqual(errors, [], 'no browser exceptions');
console.table(results.map(([check, rows, totals, exp]) => ({ check, rows, types: totals, exports: exp })));
console.log('PASS Today Report end-to-end; downloads in', directory);
ws.close();
