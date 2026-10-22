// Cash / Bank Ledger UI end-to-end: real app + real Django API on the isolated SQLite QA
// database (scratchpad seed.py + ledger_seed.py). Checks the restyled page shows exactly the
// API's rows and balances, filters, exports, export menu visibility and phone-width layout.
// Usage: node qa/ledger-statement/browser.mjs <today ISO> <admin> <pass>
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
const [TODAY, ADMIN, PASS] = process.argv.slice(2);
const directory = mkdtempSync(resolve('../docs/ledger-ui-qa-'));
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
const setInput = (selector, value) => evaluate(`(()=>{const e=${selector};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const NAV = `document.querySelector('nav[aria-label="Main navigation"]')`;
const PAGE = '.ls-page';
const money = value => '₹' + Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = iso => iso.slice(0, 10).split('-').reverse().join('/');
const api = params => evaluate(`(async()=>{const t=JSON.parse(localStorage.getItem('finance_session')).token;
  return (await fetch('http://127.0.0.1:8765/api/finance/reports/ledger/?'+new URLSearchParams(${JSON.stringify(params)}),{headers:{Authorization:'Token '+t}})).json();})()`);
const grid = () => evaluate(`({rows:[...document.querySelectorAll('${PAGE} .rpt-ledger-rows tbody tr:not(.ls-opening-row):not(.rpt-empty-row)')].map(tr=>[...tr.cells].map(td=>td.textContent.trim())),
  opening:document.querySelector('${PAGE} .ls-opening-row td:last-child').textContent.trim(),
  footer:[...document.querySelectorAll('${PAGE} .rpt-ledger-summary tr')].map(tr=>[...tr.cells].map(td=>td.textContent.trim())),
  empty:document.querySelector('${PAGE} .rpt-empty-row')?.textContent.trim()||'', count:document.querySelector('${PAGE} .ls-count').textContent})`);
const matchApi = async (label, params) => {
  const data = await api(params), view = await grid();
  assert.deepEqual(view.rows.map(r => [r[1], r[2], r[3], r[4], r[5], r[6], r[7]]), data.rows.map(r => [dmy(r.date), r.particulars, r.reference, r.type,
    Number(r.debit) > 0 ? money(r.debit) : '—', Number(r.credit) > 0 ? money(r.credit) : '—', `${money(r.balance)} ${r.balance_type}`]), label + ': rows == API');
  assert.equal(view.opening, `${money(data.opening_balance)} ${data.opening_balance_type}`, label + ': opening row');
  assert.deepEqual(view.footer, [
    ['Opening Balance :', '', '', `${money(data.opening_balance)} ${data.opening_balance_type}`],
    ['Current Total :', money(data.total_debit), money(data.total_credit), ''],
    ['Closing Balance :', '', '', `${money(data.closing_balance)} ${data.closing_balance_type}`]], label + ': footer == API');
  return { data, view };
};
const download = async (label, ext) => {
  const before = new Set(readdirSync(directory));
  await evaluate(`[...document.querySelectorAll('${PAGE} button')].find(b=>b.textContent.trim()==='Export').click()`);
  await wait(`document.querySelector('[role=menuitem]')!==null`);
  const hit = await evaluate(`(()=>{const b=[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.trim()===${JSON.stringify(label)});const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[role=menuitem]')===b})()`);
  assert.ok(hit, label + ' menu item visible and clickable (not clipped)');
  await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  for (let i = 0; i < 100; i++) { const added = readdirSync(directory).filter(f => !before.has(f) && f.endsWith(ext)); if (added.length) { await sleep(400); return join(directory, added[0]); } await sleep(100); }
  throw new Error('No download ' + label);
};
const verifyExports = async (title, data) => {
  const pdf = readFileSync(await download('PDF', '.pdf')).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-') && pdf.includes('%%EOF'), title + ': PDF valid');
  for (const row of data.rows) assert.ok(pdf.includes(`(${row.reference})`), title + ': PDF row ' + row.reference);
  const xlsxPath = await download('Excel', '.xlsx');
  const sheet = XLSX.utils.sheet_to_json(Object.values(XLSX.read(readFileSync(xlsxPath)).Sheets)[0], { header: 1, defval: '' });
  const body = sheet.filter(r => typeof r[0] === 'number');
  assert.deepEqual(body.map(r => [r[3], Number(r[5] || 0), Number(r[6] || 0)]), data.rows.map(r => [r.reference, Number(r.debit), Number(r.credit)]), title + ': XLSX rows');
  const closing = sheet.find(r => r[0] === 'Closing Balance');
  // The shared Excel writer stores "₹1,100.00 DR" as the number 1100 with a "DR" display format.
  assert.equal(Number(String(closing[7]).replace(/[^0-9.]/g, '')), Number(data.closing_balance), title + ': XLSX closing');
  return xlsxPath.split(/[\\/]/).pop();
};

await call('Runtime.enable');
await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
await call('Page.navigate', { url: 'http://127.0.0.1:5179/chitfund/login' });
await wait(`document.readyState==='complete'`); await evaluate('localStorage.clear()');
await call('Page.navigate', { url: 'http://127.0.0.1:5179/chitfund/login' });
await wait(`document.querySelectorAll('input').length>=2`);
await setInput(`document.querySelectorAll('input')[0]`, ADMIN); await setInput(`document.querySelectorAll('input')[1]`, PASS);
await evaluate(`document.querySelector('form').requestSubmit()`);
await wait(`${NAV}!==null`, 'login');
const results = [];

for (const [title, kind, searchTerm] of [['Cash Ledger', 'cash', 'Stationery'], ['Bank Ledger', 'bank', 'Collection']]) {
  // Open from the sidebar: Reports -> Accounts Reports -> <ledger>.
  if (!(await evaluate(`[...${NAV}.querySelectorAll('a')].some(a=>a.textContent.trim()===${JSON.stringify(title)})`))) {
    if (!(await evaluate(`[...${NAV}.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('Accounts Reports'))`))) await evaluate(`[...${NAV}.querySelectorAll('button')].find(b=>b.textContent.toUpperCase().includes('REPORTS')).click()`);
    await wait(`[...${NAV}.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('Accounts Reports'))`);
    await evaluate(`[...${NAV}.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Accounts Reports')).click()`);
  }
  await wait(`[...${NAV}.querySelectorAll('a')].some(a=>a.textContent.trim()===${JSON.stringify(title)})`);
  await evaluate(`[...${NAV}.querySelectorAll('a')].find(a=>a.textContent.trim()===${JSON.stringify(title)}).click()`);
  await wait(`!!document.querySelector('${PAGE}') && document.querySelector('${PAGE} .rpt-breadcrumb').textContent.includes(${JSON.stringify(title)})`, title);
  await idle();

  // Design: navy header, white bold headings, right-aligned money, no KPI cards.
  const style = await evaluate(`(()=>{const th=document.querySelector('${PAGE} thead th'),num=document.querySelector('${PAGE} thead th.num'),s=getComputedStyle(th);return {bg:getComputedStyle(th.closest('thead')).backgroundImage,color:s.color,weight:Number(s.fontWeight),align:getComputedStyle(num).textAlign}})()`);
  assert.equal(style.color, 'rgb(255, 255, 255)'); assert.ok(style.weight >= 700); assert.equal(style.align, 'right');
  assert.ok(style.bg.startsWith('linear-gradient(135deg, rgb(18, 58, 99)'), 'navy header (same thead gradient as Today Report) ' + style.bg);
  assert.equal(await evaluate(`!!document.querySelector('${PAGE} .cards, ${PAGE} .ls-summary, ${PAGE} .card')`), false, 'no KPI cards');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('${PAGE} .rpt-ledger-rows thead th')].map(th=>th.textContent)`), ['S.No', 'Date', 'Particulars', 'Voucher No', 'Type', 'Debit', 'Credit', 'Balance']);

  let { data, view } = await matchApi(title, { type: kind });
  assert.ok(view.rows.length > 0, title + ': existing transactions shown');
  assert.ok(view.count.includes(`Showing ${view.rows.length} of ${data.rows.length}`));
  const exportsAll = await verifyExports(title, data);

  // Search filter (client side, unchanged behaviour).
  await setInput(`document.querySelector('${PAGE} .ls-search input')`, searchTerm); await sleep(300);
  const searched = await grid();
  assert.ok(searched.rows.length >= 1 && searched.rows.every(row => row.join(' ').includes(searchTerm)), title + ': search');
  assert.ok(searched.count.includes(`Showing ${searched.rows.length} of ${data.rows.length}`));
  await setInput(`document.querySelector('${PAGE} .ls-search input')`, ''); await sleep(300);

  // Date range filter: from today → opening carries earlier entries, rows limited to the range.
  await setInput(`document.querySelector('${PAGE} input[aria-label="From date"]')`, TODAY); await idle();
  ({ data, view } = await matchApi(title + ' from today', { type: kind, from: TODAY }));
  assert.ok(view.rows.every(row => row[1] === dmy(TODAY)));
  await setInput(`document.querySelector('${PAGE} input[aria-label="From date"]')`, '2020-01-01');
  await setInput(`document.querySelector('${PAGE} input[aria-label="To date"]')`, '2020-01-31'); await idle();
  ({ view } = await matchApi(title + ' empty', { type: kind, from: '2020-01-01', to: '2020-01-31' }));
  assert.equal(view.empty, 'No transactions found for the selected period.');
  await setInput(`document.querySelector('${PAGE} input[aria-label="From date"]')`, '');
  await setInput(`document.querySelector('${PAGE} input[aria-label="To date"]')`, ''); await idle();
  ({ data } = await matchApi(title + ' reset', { type: kind }));
  results.push([title, `${data.rows.length} rows · opening ${data.opening_balance} ${data.opening_balance_type} · Dr ${data.total_debit} / Cr ${data.total_credit} · closing ${data.closing_balance} ${data.closing_balance_type}`, exportsAll]);

  // Phone width: no horizontal page scroll, controls stay on screen.
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(600);
  const phone = await evaluate(`({over:document.documentElement.scrollWidth-innerWidth, search:document.querySelector('${PAGE} .ls-search input').getBoundingClientRect().right<=innerWidth+1, from:document.querySelector('${PAGE} input[aria-label="From date"]').getBoundingClientRect().right<=innerWidth+1})`);
  assert.ok(phone.over <= 1 && phone.search && phone.from, title + ': phone layout ' + JSON.stringify(phone));
  await call('Emulation.clearDeviceMetricsOverride'); await sleep(400);
}

assert.deepEqual(errors, [], 'no browser exceptions');
console.table(results.map(([page, detail, exportsFile]) => ({ page, detail, exports: exportsFile })));
console.log('PASS Cash/Bank Ledger UI; downloads in', directory);
ws.close();
