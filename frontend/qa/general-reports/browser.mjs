// General Reports sidebar: structure, routes, active state, expand/collapse, and that Today Report
// and Today Collection Report open as separate pages with their own PDF/Excel exports.
// Needs: `npx vite --port 5179` from frontend, headless Chrome with --remote-debugging-port=9239.
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
const directory = mkdtempSync(resolve('../docs/general-reports-qa-'));
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
const wait = async (predicate, label = predicate) => { for (let i = 0; i < 100; i++) { if (await evaluate(predicate)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Timeout: ' + label); };

const NAV = `document.querySelector('nav[aria-label="Main navigation"]')`;
const category = name => `[...${NAV}.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(name)}))`;
const categoryLinks = name => evaluate(`(()=>{const b=${category(name)};return b?[...b.parentElement.querySelectorAll('a')].map(a=>a.textContent.trim()):null})()`);
const navTexts = () => evaluate(`[...${NAV}.querySelectorAll('a,button')].map(e=>e.textContent.replace('›','').trim())`);
const activeLinks = () => evaluate(`[...${NAV}.querySelectorAll('a')].filter(a=>/active/i.test(a.className)).map(a=>a.textContent.trim())`);
const clickLink = text => evaluate(`[...${NAV}.querySelectorAll('a')].find(a=>a.textContent.trim()===${JSON.stringify(text)}).click()`);
const main = () => evaluate(`document.querySelector('main').textContent`);
const path = () => evaluate('location.pathname');

const download = async (label, ext) => {
  const before = new Set(readdirSync(directory));
  await evaluate(`[...document.querySelectorAll('main button')].find(b=>b.textContent.trim()==='Export').click()`);
  await wait(`document.querySelector('[role=menuitem]')!==null`);
  await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);
  for (let i = 0; i < 100; i++) {
    const added = readdirSync(directory).filter(f => !before.has(f) && f.endsWith(ext));
    if (added.length) { await new Promise(r => setTimeout(r, 300)); return resolve(directory, added[0]); }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('No download for ' + label);
};
const checkExports = async (title, yesterdayPending) => {
  const pdfPath = await download('PDF', '.pdf'), pdf = readFileSync(pdfPath).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-') && pdf.includes('%%EOF'), title + ': valid PDF');
  assert.ok(pdf.includes(`(${title.toUpperCase()})`), title + ': PDF heading');
  assert.equal(pdf.includes('(Yesterday Pending)'), yesterdayPending, title + ': PDF Yesterday Pending KPI');
  assert.ok(pdf.includes('(Due Days)') && pdf.includes('(QA Kumar'), title + ': PDF Due Days column + data row');
  const xlsxPath = await download('Excel', '.xlsx');
  const sheet = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(xlsxPath)).Sheets[XLSX.read(readFileSync(xlsxPath)).SheetNames[0]], { header: 1, defval: '' });
  const flat = sheet.flat().map(String);
  assert.ok(flat.some(v => v.toUpperCase() === title.toUpperCase()), title + ': Excel title');
  assert.ok(flat.includes('Due Days') && flat.includes('QA Kumar') && flat.includes('3'), title + ': Excel Due Days + data');
  return [pdfPath, xlsxPath].map(p => p.split(/[\\/]/).pop());
};

await call('Runtime.enable');
await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: 'http://127.0.0.1:5179/chitfund/qa/general-reports/index.html' });
await wait(`!!document.querySelector('.today-report-page') && document.querySelector('main').textContent.includes('QA Today Loan')`, 'Today Report renders');
const results = [];

// 1. Structure.
assert.deepEqual(await categoryLinks('General Reports'), ['Today Report', 'Today Collection Report', 'Payment History']);
const texts = await navTexts();
for (const removed of ['Today Collection History', 'Collection Entry History', 'Collection History']) assert.ok(!texts.includes(removed), 'removed from sidebar: ' + removed);
assert.ok(texts.includes('Loan Reports') && texts.includes('Accounts Reports'), 'Loan/Accounts Reports categories kept');
results.push(['Sidebar structure', 'General Reports = Today Report, Today Collection Report, Payment History; history entries absent']);

// 2. Today Report (/today-collection -> CollectionEntryPage).
assert.equal(await path(), '/chitfund/today-collection');
assert.deepEqual(await activeLinks(), ['Today Report']);
let page = await main();
assert.ok(page.includes('Transaction Type') && page.includes('QA Today Loan') && !page.includes('Yesterday Pending'), 'Today Report = transaction register');
results.push(['Today Report', '/today-collection', 'transaction register (exports covered by qa/today-report)', '']);

// 3. Today Collection Report (/reports/today-collection -> CollectionDashboard).
await clickLink('Today Collection Report');
await wait(`location.pathname==='/chitfund/reports/today-collection' && !!document.querySelector('.today-collection-page') && document.querySelector('main').textContent.includes('QA Chit Plan')`, 'Today Collection Report renders');
page = await main();
assert.ok(page.includes('Due Days') && page.includes('As of') && page.includes('Overdue') && !page.includes('Yesterday Pending'), 'Today Collection Report = pending dues with Due Days and as-of date');
assert.ok(!(await evaluate(`!!document.querySelector('.today-report-page')`)), 'not the Today Report page');
assert.equal(await evaluate(`!!document.querySelector('.collection-kpis, .collection-kpi')`), false, 'no KPI cards');
assert.deepEqual(await activeLinks(), ['Today Collection Report']);
assert.deepEqual(await categoryLinks('General Reports'), ['Today Report', 'Today Collection Report', 'Payment History'], 'category stays expanded');
results.push(['Today Collection Report', '/reports/today-collection', 'pending dues (exports covered by qa/today-collection)', '']);

// 4. Payment History unchanged.
await clickLink('Payment History');
await wait(`location.pathname==='/chitfund/payment-list' && document.querySelector('main').innerText.includes('PV-000005')`, 'Payment History renders');
assert.ok((await main()).includes('+ Payment Entry') && (await main()).includes('Voucher No'), 'Payment History list (Payment Entry action + voucher columns)');
assert.deepEqual(await activeLinks(), ['Payment History']);
results.push(['Payment History', '/payment-list', 'renders fixture payment', '']);

// 5. Back to Today Report; browser Back returns to Payment History.
await clickLink('Today Report');
await wait(`location.pathname==='/chitfund/today-collection' && !!document.querySelector('.today-report-page')`, 'back to Today Report');
await evaluate('history.back()');
await wait(`location.pathname==='/chitfund/payment-list' && document.querySelector('main').textContent.includes('+ Payment Entry')`, 'browser back');

// 6. Expand/collapse: one category open at a time, and General Reports collapses/expands.
await evaluate(`${category('Loan Reports')}.click()`);
await wait(`${category('Loan Reports')}.getAttribute('aria-expanded')==='true'`);
assert.ok((await categoryLinks('Loan Reports')).includes('Customer-wise Report'));
assert.equal(await evaluate(`${category('General Reports')}.getAttribute('aria-expanded')`), 'false');
await evaluate(`${category('Accounts Reports')}.click()`);
await wait(`${category('Accounts Reports')}.getAttribute('aria-expanded')==='true'`);
assert.ok((await categoryLinks('Accounts Reports')).includes('Trial Balance Report'));
await evaluate(`${category('General Reports')}.click()`);
await wait(`${category('General Reports')}.getAttribute('aria-expanded')==='true'`);
await evaluate(`${category('General Reports')}.click()`);
await wait(`${category('General Reports')}.getAttribute('aria-expanded')==='false'`);
results.push(['Expand/collapse', 'Loan/Accounts/General categories toggle, one open at a time', '', '']);

// 7. Removed sidebar entries keep their routes (data and APIs untouched).
await evaluate(`history.pushState({}, '', '/chitfund/reports/collections/history'); dispatchEvent(new PopStateEvent('popstate'))`);
await wait(`location.pathname==='/chitfund/reports/collections/history' && !document.querySelector('.today-report-page')`, 'history route still resolves');
await new Promise(r => setTimeout(r, 500));
results.push(['/reports/collections/history', 'route still resolves (sidebar entry only removed)', '', '']);

assert.ok(!(await evaluate('window.qaRequests.some(r=>r.method!=="get")')), 'no writes');
assert.deepEqual(errors, [], 'no browser exceptions');
console.table(results.map(([check, detail, pdf, xlsx]) => ({ check, detail, pdf, xlsx })));
console.log('PASS General Reports sidebar; downloads in', directory);
ws.close();
