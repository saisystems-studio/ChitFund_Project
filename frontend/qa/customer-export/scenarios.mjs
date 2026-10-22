// Customer / Loan Number selection matrix: grid scope, Export enablement, and real PDF/XLSX
// downloads whose rows and Opening/Current/Closing match the grid. Same harness as browser.mjs.
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
const directory = mkdtempSync(resolve('../docs/customer-scenarios-qa-'));
const targets = await (await fetch('http://127.0.0.1:9239/json')).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let sequence = 0; const pending = new Map(), errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(message.error) : task.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
});
const call = (method, params = {}) => new Promise((res, rej) => { const id = ++sequence; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const wait = async predicate => { for (let i = 0; i < 100; i++) { if (await evaluate(predicate)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error('Timeout: ' + predicate); };
const idle = "!document.querySelector('.rpt-loading')";
const rowCount = n => `${idle} && document.querySelectorAll('.rpt-ledger-rows tbody tr').length===${n}`;
await call('Runtime.enable');
await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await call('Page.navigate', { url: 'http://127.0.0.1:5179/chitfund/qa/customer-export/index.html' });
await wait(`document.querySelectorAll('[role=combobox]').length === 2 && ${idle}`);

const choose = async (index, text) => {
  await evaluate(`document.querySelectorAll('[role=combobox]')[${index}].click()`);
  await wait(`document.querySelector('[aria-label="Search options"]') !== null`);
  await evaluate(`(()=>{const e=document.querySelector('[aria-label="Search options"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await wait(`Array.from(document.querySelectorAll('[role=option]')).some(b=>b.textContent.includes(${JSON.stringify(text)}))`);
  await evaluate(`Array.from(document.querySelectorAll('[role=option]')).find(b=>b.textContent.includes(${JSON.stringify(text)})).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
};
const clearFilter = index => evaluate(`document.querySelectorAll('.rpt-dropdown-wrap')[${index}].querySelector('[aria-label="Clear selection"]').click()`);
const exportDisabled = () => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Export').disabled`);
const filterValues = () => evaluate(`[...document.querySelectorAll('[role=combobox]')].map(b=>b.value)`);
const grid = () => evaluate(`({rows:[...document.querySelectorAll('.rpt-ledger-rows tbody tr')].map(tr=>[...tr.cells].slice(0,6).map(td=>td.textContent.trim())), summary:[...document.querySelectorAll('.rpt-summary-row')].map(tr=>[...tr.cells].slice(1,3).map(td=>td.textContent.trim()))})`);
const download = async (label, ext) => {
  const before = new Set(readdirSync(directory));
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Export').click()`);
  await wait(`document.querySelector('[role=menuitem]')!==null`);
  await evaluate(`Array.from(document.querySelectorAll('[role=menuitem]')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
  for (let i = 0; i < 100; i++) {
    const added = readdirSync(directory).filter(f => !before.has(f) && f.endsWith(ext));
    if (added.length) { await new Promise(r => setTimeout(r, 300)); return resolve(directory, added[0]); }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('No download for ' + label);
};
const num = s => Number(String(s).replace(/[^0-9.]/g, '') || 0);

async function verifyExports(name, view, filenamePrefix) {
  const pdfPath = await download('Download PDF', '.pdf');
  const pdf = readFileSync(pdfPath);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', name + ': PDF header');
  assert.ok(pdf.subarray(-1024).toString().includes('%%EOF'), name + ': PDF end marker');
  assert.ok(filenamePrefix.test(pdfPath), name + ': PDF filename ' + pdfPath);
  const xlsxPath = await download('Download Excel', '.xlsx');
  assert.ok(filenamePrefix.test(xlsxPath), name + ': XLSX filename ' + xlsxPath);
  const book = XLSX.read(readFileSync(xlsxPath));
  const sheet = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: '', raw: false });
  const vchRows = sheet.filter(r => /^(CH|IN|RV)-/.test(String(r[3])));
  assert.deepEqual(vchRows.map(r => r[3]), view.rows.map(r => r[3]), name + ': XLSX rows == grid rows');
  assert.deepEqual(vchRows.map(r => [num(r[4]), num(r[5])]), view.rows.map(r => [num(r[4]), num(r[5])]), name + ': XLSX Dr/Cr == grid');
  const summary = label => sheet.find(r => r[0] === label).slice(4, 6).map(v => String(v).toUpperCase());
  assert.deepEqual([summary('Opening Balance'), summary('Current Total'), summary('Closing Balance')], view.summary.map(r => r.map(v => v.toUpperCase())), name + ': XLSX summary == grid summary');
  return { pdf: `${pdfPath.split(/[\\/]/).pop()} (${pdf.length} B)`, xlsx: xlsxPath.split(/[\\/]/).pop() };
}

const results = [];
// Customer only -> every Kumar loan aggregated in date order, export enabled.
await choose(0, 'Kumar'); await wait(rowCount(3));
assert.equal((await filterValues())[1], '', 'customer must not force a loan');
assert.equal(await exportDisabled(), false);
let view = await grid();
assert.deepEqual(view.rows.map(r => r[3]).sort(), ['CH-0001', 'IN-0001', 'RV-000001']);
assert.deepEqual(view.summary, [['₹0.00', ''], ['₹105.00', '₹20.00'], ['₹85.00 Dr', '']]);
results.push(['Customer only (Kumar)', view, await verifyExports('customer-only', view, /Customer_Wise_Report_Kumar_\d{2}_\d{2}_\d{4}\./)]);

// Customer + Loan -> only that loan.
await choose(1, 'CH-0001'); await wait(rowCount(2));
view = await grid();
assert.deepEqual(view.rows.map(r => r[3]), ['CH-0001', 'RV-000001']);
assert.deepEqual(view.summary, [['₹0.00', ''], ['₹50.00', '₹20.00'], ['₹30.00 Dr', '']]);
assert.equal(await exportDisabled(), false);
results.push(['Customer + Loan (Kumar, CH-0001)', view, await verifyExports('both', view, /Customer_Wise_Report_Kumar_CH_0001_/)]);

// Clearing the loan keeps the customer and returns to all of the customer's loans.
await clearFilter(1); await wait(rowCount(3));
assert.ok((await filterValues())[0].includes('Kumar'));
assert.equal(await exportDisabled(), false);

// Neither -> empty grid, export disabled.
await clearFilter(0); await wait(rowCount(0));
assert.deepEqual(await filterValues(), ['', '']);
assert.equal(await exportDisabled(), true);
results.push(['Neither', await grid(), 'Export disabled']);

// Loan only -> customer resolved automatically, export enabled.
await choose(1, 'IN-0001'); await wait(rowCount(1));
assert.ok((await filterValues())[0].includes('Kumar'), 'loan resolves its customer');
view = await grid();
assert.deepEqual(view.rows.map(r => r[3]), ['IN-0001']);
assert.deepEqual(view.summary, [['₹0.00', ''], ['₹55.00', '₹0.00'], ['₹55.00 Dr', '']]);
assert.equal(await exportDisabled(), false);
results.push(['Loan only (IN-0001)', view, await verifyExports('loan-only', view, /Customer_Wise_Report_Kumar_IN_0001_/)]);

// Switching customer clears the incompatible loan and shows only the new customer's loans.
await choose(0, 'Ravi'); await wait(rowCount(1));
assert.equal((await filterValues())[1], '');
assert.deepEqual((await grid()).rows.map(r => r[3]), ['CH-0002']);

// Period filter in customer-only mode.
await choose(0, 'Kumar'); await wait(rowCount(3));
await evaluate(`(()=>{const s=document.querySelector('.rpt-field-period select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'Custom Date');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
await wait(`document.querySelectorAll('.rpt-field-date input').length===2`);
await evaluate(`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const [f,t]=document.querySelectorAll('.rpt-field-date input');set.call(f,'2099-01-01');f.dispatchEvent(new Event('input',{bubbles:true}));set.call(t,'2099-01-31');t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await wait(rowCount(0));
assert.ok(await evaluate(`window.qaRequests.some(r=>r.url.includes('customer-wise') && r.options.params.from==='2099-01-01' && !r.options.params.loan_id)`));
assert.equal(await exportDisabled(), false);

assert.deepEqual(errors, [], 'no browser exceptions');
console.table(results.map(([scenario, v, exp]) => ({ scenario, rows: v.rows.length, opening: v.summary[0].join(' '), current: v.summary[1].join(' / '), closing: v.summary[2].join(' '), export: typeof exp === 'string' ? exp : `${exp.pdf} + ${exp.xlsx}` })));
console.log('PASS customer/loan selection matrix; downloads in', directory);
ws.close();
