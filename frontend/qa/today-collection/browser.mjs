// Today Collection Report end-to-end: real app + real Django API on the isolated SQLite QA
// database (scratchpad seed.py). Same harness conventions as qa/today-report/*.mjs.
// Usage: node qa/today-collection/browser.mjs <today ISO> <admin> <pass> <viewer> <pass> <sample.jpg>
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
const [TODAY, ADMIN, ADMIN_PASS, VIEWER, VIEWER_PASS, SAMPLE] = process.argv.slice(2);
const directory = mkdtempSync(resolve('../docs/today-collection-qa-'));
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const idle = async () => { await wait(`!document.querySelector('.rpt-loading')`); await sleep(300); await wait(`!document.querySelector('.rpt-loading')`); };
const setInput = (selector, value) => evaluate(`(()=>{const e=${selector};const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`);
const PAGE = '.today-collection-page';
const NAV = `document.querySelector('nav[aria-label="Main navigation"]')`;
const field = label => `[...document.querySelectorAll('${PAGE} label.rpt-field')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)}))`;
const grid = () => evaluate(`({rows:[...document.querySelectorAll('${PAGE} tbody tr:not(.rpt-empty-row)')].map(tr=>[...tr.cells].slice(0,8).map(td=>td.textContent.trim())), foot:document.querySelectorAll('${PAGE} tfoot tr').length, text:document.querySelector('${PAGE} table').innerText})`);
const amount = text => Number(String(text).replace(/[^0-9.]/g, ''));
const dateLabel = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const daysBetween = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
const api = params => evaluate(`(async()=>{const t=JSON.parse(localStorage.getItem('finance_session')).token;
  const r=await fetch('http://127.0.0.1:8765/api/finance/reports/today-collection/?'+new URLSearchParams(${JSON.stringify(params)}),{headers:{Authorization:'Token '+t}});return r.json();})()`);
const login = async (user, pass) => {
  await call('Page.navigate', { url: 'http://127.0.0.1:5179/chitfund/login' });
  await wait(`document.readyState==='complete'`); await evaluate('localStorage.clear()');
  await call('Page.navigate', { url: 'http://127.0.0.1:5179/chitfund/login' });
  await wait(`document.querySelectorAll('input').length>=2`);
  await setInput(`document.querySelectorAll('input')[0]`, user); await setInput(`document.querySelectorAll('input')[1]`, pass);
  await evaluate(`document.querySelector('form').requestSubmit()`);
  await wait(`${NAV}!==null`, 'login');
  await evaluate(`[...${NAV}.querySelectorAll('button')].find(b=>b.textContent.toUpperCase().includes('REPORTS')).click()`);
  await wait(`[...${NAV}.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('General Reports'))`);
  if (!(await evaluate(`[...${NAV}.querySelectorAll('a')].some(a=>a.textContent.trim()==='Today Collection Report')`))) await evaluate(`[...${NAV}.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('General Reports')).click()`);
  await wait(`[...${NAV}.querySelectorAll('a')].some(a=>a.textContent.trim()==='Today Collection Report')`);
  await evaluate(`[...${NAV}.querySelectorAll('a')].find(a=>a.textContent.trim()==='Today Collection Report').click()`);
  await wait(`location.pathname==='/chitfund/reports/today-collection' && !!document.querySelector('${PAGE}')`, 'page');
  await idle();
};
// Grid must equal the API dataset, and obey the report rules independently of the backend.
const checkAgainstApi = async (label, params) => {
  const data = await api(params), view = await grid();
  assert.equal(view.foot, 0, label + ': no subtotal rows');
  assert.ok(!/(Loans|Receipts|Payments) \(\d+\)/i.test(view.text), label + ': no subtotal text');
  assert.deepEqual(view.rows.map(r => [r[1], r[2], r[4], Number(r[6]), amount(r[7])]),
    data.rows.map(r => [dateLabel(r.date), r.transaction_type, r.loan_no, r.due_days, Number(r.amount)]), label + ': grid == API');
  for (const row of data.rows) {
    assert.ok(row.date <= data.as_of, label + ': no future dues');
    assert.equal(row.due_days, daysBetween(data.as_of, row.date), label + ': due days');
    assert.equal(row.transaction_type, row.due_days > 0 ? 'Overdue' : 'Due Today');
    assert.ok(Number(row.amount) > 0 && Number(row.amount) <= Number(row.due_amount), label + ': pending within due');
  }
  assert.equal(new Set(data.rows.map(r => r.key)).size, data.rows.length, label + ': no duplicate installments');
  assert.ok((await evaluate(`document.querySelector('${PAGE} .today-collection-as-of')?.textContent||''`)).includes(dateLabel(data.as_of)), label + ': as-of shown');
  return { data, view };
};
const download = async (label, ext) => {
  const before = new Set(readdirSync(directory));
  await evaluate(`[...document.querySelectorAll('${PAGE} button')].find(b=>b.textContent.trim()==='Export').click()`);
  await wait(`document.querySelector('[role=menuitem]')!==null`);
  await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  for (let i = 0; i < 100; i++) { const added = readdirSync(directory).filter(f => !before.has(f) && f.endsWith(ext)); if (added.length) { await sleep(400); return join(directory, added[0]); } await sleep(100); }
  throw new Error('No download ' + label);
};
const verifyExports = async (label, view) => {
  const pdfPath = await download('Download PDF', '.pdf'), pdf = readFileSync(pdfPath).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-') && pdf.includes('%%EOF') && pdf.includes('(Due Days)') && pdf.includes('(Pending Amount)'), label + ': PDF');
  assert.ok(!/\((Loans|Receipts|Payments) \(\d+\)/i.test(pdf), label + ': PDF no subtotals');
  for (const row of view.rows) assert.ok(pdf.includes(`(${row[4]})`), label + ': PDF row ' + row[4]);
  const xlsxPath = await download('Download Excel', '.xlsx');
  const sheet = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(xlsxPath)).Sheets['Report'] || Object.values(XLSX.read(readFileSync(xlsxPath)).Sheets)[0], { header: 1, defval: '' });
  const header = sheet.find(r => r[0] === 'S.No');
  assert.deepEqual(header, ['S.No', 'Date', 'Transaction Type', 'Loan Type', 'Loan Number', 'Customer / Particulars', 'Due Amount', 'Paid Amount', 'Due Days', 'Pending Amount']);
  const body = sheet.filter(r => typeof r[0] === 'number');
  assert.deepEqual(body.map(r => [r[2], r[4], Number(r[8]), Number(r[9])]), view.rows.map(r => [r[2], r[4], Number(r[6]), amount(r[7])]), label + ': XLSX == grid');
  assert.equal(sheet.length, sheet.indexOf(header) + 1 + view.rows.length, label + ': XLSX has only transaction rows');
  assert.ok(sheet.flat().some(v => String(v).includes('As of')), label + ': XLSX as-of line');
  return `${pdfPath.split(/[\\/]/).pop()} + ${xlsxPath.split(/[\\/]/).pop()}`;
};

await call('Runtime.enable'); await call('DOM.enable');
await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
const results = [];
await login(ADMIN, ADMIN_PASS);
assert.deepEqual(await evaluate(`[...document.querySelectorAll('${PAGE} thead th')].map(th=>th.textContent.trim())`),
  ['S.No', 'Date', 'Transaction Type', 'Loan Type', 'Loan Number', 'Customer / Particulars', 'Due Days', 'Amount', 'Documents']);
assert.equal(await evaluate(`!!document.querySelector('.collection-kpis, .collection-kpi')`), false, 'no KPI cards');

// Today: seed has CH-0002 (Ravi, started day −10, nothing collected) → three overdue dues 10/9/8 days.
let { data, view } = await checkAgainstApi('Today', { from: TODAY, to: TODAY });
assert.equal(data.as_of, TODAY);
const ch2 = data.rows.filter(r => r.loan_no === 'CH-0002');
assert.deepEqual(ch2.map(r => [r.due_days, Number(r.amount)]), [[10, 50], [9, 50], [8, 50]]);
assert.ok(!data.rows.some(r => r.loan_no === 'CH-0001' && r.date === TODAY), 'CH-0001 today due fully collected');
results.push(['Today', view.rows.length, view.rows.map(r => `${r[4]}:${r[6]}d`).join(' '), await verifyExports('today', view)]);

// Filters.
await setInput(`${field('Loan Type')}.querySelector('select')`, 'Chit'); await idle();
({ view } = await checkAgainstApi('Loan Type Chit', { from: TODAY, to: TODAY, loan_type: 'Chit' }));
assert.ok(view.rows.length && view.rows.every(r => r[3] === 'Chit'));
results.push(['Loan Type = Chit', view.rows.length, [...new Set(view.rows.map(r => r[4]))].join(','), '']);
await setInput(`${field('Loan Type')}.querySelector('select')`, 'All'); await idle();
await evaluate(`${field('Loan Number')}.querySelector('[role=combobox]').click()`);
await wait(`document.querySelector('[aria-label="Search options"]')!==null`);
await setInput(`document.querySelector('[aria-label="Search options"]')`, 'CH-0002');
await wait(`[...document.querySelectorAll('[role=option]')].some(o=>o.textContent.startsWith('CH-0002'))`);
await evaluate(`[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.startsWith('CH-0002')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`); await idle();
const ch2Id = ch2[0].loan_id;
({ view } = await checkAgainstApi('Loan CH-0002', { from: TODAY, to: TODAY, loan_id: ch2Id }));
assert.deepEqual(view.rows.map(r => r[4]), ['CH-0002', 'CH-0002', 'CH-0002']);
results.push(['Loan Number = CH-0002', view.rows.length, view.rows.map(r => `${r[6]}d`).join(' '), await verifyExports('loan', view)]);
await evaluate(`${field('Loan Number')}.querySelector('[aria-label="Clear selection"]').click()`); await idle();

// Periods: as-of = period end capped at today; Past Week as-of = last Sunday.
for (const period of ['This Week', 'This Month']) {
  await setInput(`${field('Period')}.querySelector('select')`, period); await idle();
  ({ data, view } = await checkAgainstApi(period, { from: TODAY, to: TODAY }));
  results.push([period, view.rows.length, `as of ${data.as_of}`, '']);
}
await setInput(`${field('Period')}.querySelector('select')`, 'Past Week'); await idle();
const weekday = new Date(`${TODAY}T00:00:00Z`).getUTCDay();
const lastSunday = new Date(Date.parse(`${TODAY}T00:00:00Z`) - ((weekday + 6) % 7 + 1) * 86400000).toISOString().slice(0, 10);
const lastMonday = new Date(Date.parse(`${lastSunday}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
({ data, view } = await checkAgainstApi('Past Week', { from: lastMonday, to: lastSunday }));
assert.equal(data.as_of, lastSunday);
results.push(['Past Week', view.rows.length, `as of ${data.as_of}`, await verifyExports('past-week', view)]);
await setInput(`${field('Period')}.querySelector('select')`, 'Custom Range');
await wait(`!!${field('From Date')}`);
await setInput(`${field('From Date')}.querySelector('input')`, '2026-01-01');
await setInput(`${field('To Date')}.querySelector('input')`, '2026-01-31'); await idle();
({ view } = await checkAgainstApi('Custom Jan', { from: '2026-01-01', to: '2026-01-31' }));
assert.equal(view.rows.length, 0); assert.ok(view.text.includes('No pending dues'));
results.push(['Custom Jan 2026', 0, 'empty state', '']);
await setInput(`${field('Period')}.querySelector('select')`, 'Today'); await idle();

// Documents: attach a file to an overdue CH-0002 due → it is that loan's KYC document.
const docCell = `[...document.querySelectorAll('${PAGE} tbody tr')].find(tr=>tr.cells[4].textContent==='CH-0002').cells[8]`;
assert.equal(await evaluate(`${docCell}.querySelector('.today-docs-count').textContent`), '0');
await evaluate(`[...${docCell}.querySelectorAll('button')].find(b=>b.textContent==='Attach').click()`);
await wait(`!!document.querySelector('[role=dialog] input[type=file]')`);
const { root } = await call('DOM.getDocument', { depth: -1, pierce: true });
const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '[role=dialog] input[type=file]' });
await call('DOM.setFileInputFiles', { nodeId, files: [SAMPLE] });
await wait(`document.querySelector('[role=dialog]').textContent.includes('upload-proof.jpg')`);
await evaluate(`[...document.querySelector('[role=dialog]').querySelectorAll('button')].find(b=>b.textContent==='Add Document').click()`);
await wait(`document.querySelector('[role=dialog]').textContent.includes('1 Documents')`);
await evaluate(`document.querySelector('[role=dialog] [aria-label=Close]').click()`); await idle();
assert.deepEqual(await evaluate(`[...document.querySelectorAll('${PAGE} tbody tr')].filter(tr=>tr.cells[4].textContent==='CH-0002').map(tr=>tr.cells[8].querySelector('.today-docs-count').textContent)`), ['1', '1', '1']);
assert.equal(await evaluate(`(async()=>{const t=JSON.parse(localStorage.getItem('finance_session')).token;return (await (await fetch('http://127.0.0.1:8765/api/finance/loans/${ch2Id}/kyc-documents/',{headers:{Authorization:'Token '+t}})).json()).length})()`), 1);
await evaluate(`[...${docCell}.querySelectorAll('button')].find(b=>b.textContent==='View').click()`);
await wait(`[...document.querySelectorAll('[role=dialog] img')].some(i=>i.complete&&i.naturalWidth>0&&i.src.startsWith('blob:'))`, 'preview');
await evaluate(`document.querySelector('[role=dialog] [aria-label=Close]').click()`);
results.push(['Documents', 3, 'upload → CH-0002 loan KYC; View preview (blob)', '']);

// View-only user.
await login(VIEWER, VIEWER_PASS);
({ view } = await checkAgainstApi('Viewer', { from: TODAY, to: TODAY }));
assert.equal(await evaluate(`document.querySelectorAll('${PAGE} .today-docs-cell').length`), 0);
assert.ok(view.rows.length > 0);
results.push(['View-only user', view.rows.length, 'rows visible, Documents "—"', '']);

assert.deepEqual(errors, [], 'no browser exceptions');
console.table(results.map(([check, rows, detail, exports]) => ({ check, rows, detail, exports })));
console.log('PASS Today Collection Report end-to-end; downloads in', directory);
ws.close();
