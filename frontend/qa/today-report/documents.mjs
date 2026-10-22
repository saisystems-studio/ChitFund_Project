// Today Report document attachments end-to-end: real app + real Django API on the isolated
// SQLite QA database (seed adds loan/receipt/payment attachments and a view-only user).
// Chrome needs --use-fake-ui-for-media-stream --use-fake-device-for-media-stream for Take Photo.
// Usage: node qa/today-report/documents.mjs <admin user> <admin pass> <viewer user> <viewer pass> <private_kyc dir> <sample.jpg>
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
const [ADMIN, ADMIN_PASS, VIEWER, VIEWER_PASS, PRIVATE_DIR, SAMPLE] = process.argv.slice(2);
const directory = mkdtempSync(resolve('../docs/today-documents-qa-'));
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
const idle = async () => { await wait(`!document.querySelector('.rpt-loading')`); await sleep(250); await wait(`!document.querySelector('.rpt-loading')`); };
const setValue = (selector, value) => evaluate(`(()=>{const e=${selector};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const NAV = `document.querySelector('nav[aria-label="Main navigation"]')`;
const rowOf = voucher => `[...document.querySelectorAll('.today-report-page tbody tr')].find(tr=>tr.cells[5]?.textContent.includes(${JSON.stringify(voucher)}))`;
const docCell = voucher => `${rowOf(voucher)}.cells[7]`;
const count = voucher => evaluate(`${docCell(voucher)}.querySelector('.today-docs-count')?.textContent ?? ${docCell(voucher)}.textContent.trim()`);
const clickDoc = (voucher, label) => evaluate(`[...${docCell(voucher)}.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
const dialog = `document.querySelector('[role=dialog]')`;
const closeDialog = async () => { await evaluate(`${dialog}.querySelector('[aria-label=Close]').click()`); await wait(`!document.querySelector('[role=dialog]')`); await idle(); };
const newDownload = async (before, ext) => {
  for (let i = 0; i < 100; i++) {
    const added = readdirSync(directory).filter(f => !before.has(f) && f.endsWith(ext) && !f.endsWith('.crdownload'));
    if (added.length) { await sleep(300); return join(directory, added[0]); }
    await sleep(100);
  }
  throw new Error('No download ' + ext);
};
const storedFile = (folder, name) => {
  // Seeded files keep their original names only in the DB; match the stored private file by bytes.
  const root = join(PRIVATE_DIR, folder);
  return readdirSync(root).map(f => readFileSync(join(root, f)));
};
const login = async (user, pass) => {
  await call('Page.navigate', { url: 'http://127.0.0.1:5179/chitfund/login' });
  await wait(`document.readyState==='complete'`);
  await evaluate('localStorage.clear()');
  await call('Page.navigate', { url: 'http://127.0.0.1:5179/chitfund/login' });
  await wait(`document.querySelectorAll('input').length>=2`);
  await setValue(`document.querySelectorAll('input')[0]`, user);
  await setValue(`document.querySelectorAll('input')[1]`, pass);
  await evaluate(`document.querySelector('form').requestSubmit()`);
  await wait(`${NAV}!==null`, 'login ' + user);
  await evaluate(`[...${NAV}.querySelectorAll('button')].find(b=>b.textContent.toUpperCase().includes('REPORTS')).click()`);
  await wait(`[...${NAV}.querySelectorAll('button')].some(b=>b.textContent.trim().startsWith('General Reports'))`);
  if (!(await evaluate(`[...${NAV}.querySelectorAll('a')].some(a=>a.textContent.trim()==='Today Report')`))) await evaluate(`[...${NAV}.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('General Reports')).click()`);
  await wait(`[...${NAV}.querySelectorAll('a')].some(a=>a.textContent.trim()==='Today Report')`);
  await evaluate(`[...${NAV}.querySelectorAll('a')].find(a=>a.textContent.trim()==='Today Report').click()`);
  await wait(`!!document.querySelector('.today-report-page tbody tr td')`, 'Today Report rows');
  await idle();
};

await call('Runtime.enable'); await call('DOM.enable');
await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
const results = [];
await login(ADMIN, ADMIN_PASS);

// 1. All three transaction types load automatically, with the Documents column and existing counts.
assert.deepEqual(await evaluate(`[...document.querySelectorAll('.today-report-page thead th')].map(th=>th.textContent.trim())`),
  ['S.No', 'Date', 'Transaction Type', 'Loan Type', 'Loan Number', 'Customer / Particulars', 'Amount', 'Documents']);
assert.deepEqual(await evaluate(`[...document.querySelectorAll('.today-report-page tbody tr')].map(tr=>tr.cells[2].textContent)`), ['Loan', 'Loan', 'Loan', 'Receipt', 'Payment']);
assert.deepEqual([await count('CH-0001'), await count('IN-0002'), await count('M-0001'), await count('RV-000002'), await count('PV-000001')], ['1', '0', '0', '1', '2']);
assert.equal(await evaluate(`[...${docCell('IN-0002')}.querySelectorAll('button')].filter(b=>b.disabled).map(b=>b.textContent).join()`), 'View,Download');
results.push(['Existing attachments shown', 'CH-0001 loan KYC 1 · RV-000002 1 · PV-000001 2 · others 0']);

// 2. View (single document) opens a secure blob preview of the loan's existing KYC document.
await clickDoc('CH-0001', 'View');
await wait(`${dialog}?.querySelector('img')?.complete && ${dialog}.querySelector('img').naturalWidth>0`, 'preview image');
assert.ok((await evaluate(`${dialog}.querySelector('img').src`)).startsWith('blob:'), 'preview is an in-memory blob, not a URL');
assert.ok((await evaluate(`${dialog}.textContent`)).includes('Aadhaar Card'));
await closeDialog();
results.push(['View (1 doc)', 'blob preview of Aadhaar Card on Loan CH-0001']);

// 3. Download (single document) saves the receipt's own file, byte-identical to private storage.
let before = new Set(readdirSync(directory));
await clickDoc('RV-000002', 'Download');
let saved = await newDownload(before, '.jpg');
assert.ok(saved.endsWith('receipt-slip.jpg'));
assert.ok(storedFile('transaction_documents/receipt_2').some(buf => buf.equals(readFileSync(saved))), 'downloaded bytes == stored private file');
results.push(['Download (1 doc)', 'receipt-slip.jpg matches private storage']);

// 4. Several documents: View opens the list (no upload form); per-document preview and download.
await clickDoc('PV-000001', 'View');
await wait(`${dialog}?.textContent.includes('Rent Receipt') && ${dialog}.textContent.includes('Rent Bill')`, 'payment list');
assert.equal(await evaluate(`!!${dialog}.querySelector('input[type=file]')`), false, 'View mode has no upload form');
before = new Set(readdirSync(directory));
await evaluate(`[...${dialog}.querySelectorAll('button')].find(b=>b.textContent==='Download').click()`);
saved = await newDownload(before, '.jpg');
assert.ok(/rent-(bill|receipt)\.jpg$/.test(saved));
await evaluate(`${dialog}.querySelector('button[title=Preview]').click()`);
await wait(`[...document.querySelectorAll('[role=dialog] img')].some(i=>i.complete&&i.naturalWidth>0)`, 'list preview');
await evaluate(`[...document.querySelectorAll('[role=dialog]')].pop().querySelector('[aria-label=Close]').click()`);
await sleep(200);
await closeDialog();
results.push(['View/Download (2 docs)', `list → preview + ${saved.split(/[\\/]/).pop()}`]);

// 5. Attach by Upload File to the Mortgage loan row (no documents yet).
await clickDoc('M-0001', 'Attach');
await wait(`!!${dialog}?.querySelector('input[type=file]')`, 'attach form');
assert.ok(await evaluate(`[...${dialog}.querySelectorAll('button')].some(b=>b.textContent.includes('Upload')) && [...${dialog}.querySelectorAll('button')].some(b=>b.textContent.includes('Camera')) && !!${dialog}.querySelector('[role=combobox]')`), 'type dropdown + Upload + Camera');
const { root } = await call('DOM.getDocument', { depth: -1, pierce: true });
const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector: '[role=dialog] input[type=file]' });
await call('DOM.setFileInputFiles', { nodeId, files: [SAMPLE] });
await wait(`${dialog}.textContent.includes('upload-proof.jpg')`, 'file picked');
await evaluate(`${dialog}.querySelector('[aria-label="Preview selected document"]').click()`);
await wait(`[...document.querySelectorAll('[role=dialog] img')].some(i=>i.complete&&i.naturalWidth>0)`, 'local preview');
await evaluate(`[...document.querySelectorAll('[role=dialog]')].pop().querySelector('[aria-label=Close]').click()`);
await evaluate(`[...${dialog}.querySelectorAll('button')].find(b=>b.textContent==='Add Document').click()`);
await wait(`${dialog}.textContent.includes('1 Documents') && ${dialog}.textContent.includes('Saved')`, 'uploaded');
await closeDialog();
assert.equal(await count('M-0001'), '1');
results.push(['Attach — Upload File', 'M-0001 loan 0 → 1 (stored as that loan\'s KYC document)']);

// 6. Attach by Take Photo (fake camera) to the receipt row.
await clickDoc('RV-000002', 'Attach');
await wait(`!!${dialog}?.querySelector('input[type=file]')`);
await evaluate(`[...${dialog}.querySelectorAll('button')].find(b=>b.textContent.includes('Camera')).click()`);
await wait(`[...document.querySelectorAll('[role=dialog]')].some(d=>d.getAttribute('aria-label')==='Capture document photo')`);
const cam = `[...document.querySelectorAll('[role=dialog]')].find(d=>d.getAttribute('aria-label')==='Capture document photo')`;
await wait(`[...${cam}.querySelectorAll('button')].some(b=>b.textContent==='Capture' && !b.disabled)`, 'camera ready');
await evaluate(`[...${cam}.querySelectorAll('button')].find(b=>b.textContent==='Capture').click()`);
await wait(`[...${cam}.querySelectorAll('button')].some(b=>b.textContent==='Confirm Photo')`, 'captured');
await evaluate(`[...${cam}.querySelectorAll('button')].find(b=>b.textContent==='Confirm Photo').click()`);
await wait(`${dialog}.textContent.includes('capture-')`, 'photo picked');
await evaluate(`[...${dialog}.querySelectorAll('button')].find(b=>b.textContent==='Add Document').click()`);
await wait(`${dialog}.textContent.includes('2 Documents')`, 'photo uploaded');
await closeDialog();
assert.deepEqual([await count('RV-000002'), await count('CH-0001'), await count('PV-000001'), await count('M-0001')], ['2', '1', '2', '1'], 'photo only on its own receipt — not the loan/customer rows');
assert.equal(readdirSync(join(PRIVATE_DIR, 'transaction_documents/receipt_2')).length, 2);
results.push(['Attach — Take Photo', 'RV-000002 1 → 2; CH-0001 (same customer/loan) unchanged']);

// 7. Exports unchanged: no Documents column, same rows.
before = new Set(readdirSync(directory));
await evaluate(`[...document.querySelectorAll('.today-report-page button')].find(b=>b.textContent.trim()==='Export').click()`);
await wait(`document.querySelector('[role=menuitem]')!==null`);
await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.trim()==='Download Excel').click()`);
const xlsx = XLSX.read(readFileSync(await newDownload(before, '.xlsx')));
const sheet = XLSX.utils.sheet_to_json(xlsx.Sheets[xlsx.SheetNames[0]], { header: 1, defval: '' });
const header = sheet.find(r => r[0] === 'S.No');
assert.deepEqual(header, ['S.No', 'Date', 'Transaction Type', 'Loan Type', 'Loan Number', 'Customer / Particulars', 'Voucher No', 'Amount']);
assert.equal(sheet.filter(r => typeof r[0] === 'number').length, 5);
before = new Set(readdirSync(directory));
await evaluate(`[...document.querySelectorAll('.today-report-page button')].find(b=>b.textContent.trim()==='Export').click()`);
await wait(`document.querySelector('[role=menuitem]')!==null`);
await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.trim()==='Download PDF').click()`);
const pdf = readFileSync(await newDownload(before, '.pdf')).toString('latin1');
assert.ok(pdf.startsWith('%PDF-') && !pdf.includes('(Documents)') && !pdf.includes('/Subtype /Image'), 'PDF has no Documents column and embeds no images');
results.push(['PDF / Excel', 'unchanged columns, no documents embedded']);

// 8. View-only user: report readable, no document actions, document APIs denied.
await login(VIEWER, VIEWER_PASS);
assert.equal(await evaluate(`[...document.querySelectorAll('.today-report-page tbody tr')].length`), 5);
assert.equal(await evaluate(`document.querySelectorAll('.today-report-page tbody .today-docs-cell').length`), 0);
assert.deepEqual(await evaluate(`[...document.querySelectorAll('.today-report-page tbody tr')].map(tr=>tr.cells[7].textContent.trim())`), ['—', '—', '—', '—', '—']);
const statuses = await evaluate(`(async()=>{const t=JSON.parse(localStorage.getItem('finance_session')).token;const h={Authorization:'Token '+t};
  const get=u=>fetch('http://127.0.0.1:8765/api/finance/'+u,{headers:h}).then(r=>r.status);
  const post=await fetch('http://127.0.0.1:8765/api/finance/transaction-documents/payment/1/',{method:'POST',headers:h,body:new FormData()}).then(r=>r.status);
  return [await get('transaction-documents/payment/1/'), await get('transaction-documents/receipt/2/'), await get('loans/1/kyc-documents/'), post];})()`);
assert.deepEqual(statuses, [403, 403, 403, 403]);
results.push(['View-only user', 'report OK, Documents "—", document list/upload APIs 403']);

assert.deepEqual(errors, [], 'no browser exceptions');
console.table(results.map(([check, detail]) => ({ check, detail })));
console.log('PASS Today Report documents end-to-end; downloads in', directory);
ws.close();
