import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

registerHooks({ resolve(specifier, context, next) {
  return next(!context.parentURL?.includes('/node_modules/') && specifier.startsWith('./') && !specifier.split('/').at(-1).includes('.') ? `${specifier}.js` : specifier, context);
} });
const { createReportPdf } = await import('./reportPdf.js');
const { downloadReportExcel } = await import('./reportExcel.js');
const { createTrialBalancePdf, createProfitAndLossPdf, createBalanceSheetPdf } = await import('./accountingReportPdf.js');
const profile = { company_name: 'Synthetic QA Finance' };

test('shared report PDF generates a nonempty multipage document with headings, filters and final row', async () => {
  const rows = Array.from({ length: 180 }, (_, i) => [`QA-${i + 1}`, (i + 1).toFixed(2)]);
  const doc = await createReportPdf({ title: 'QA Ledger', filtersLine: '2026-10-05 to 2026-10-08',
    profile, columns: [{ header: 'Particulars' }, { header: 'Amount', align: 'right' }], rows });
  const output = doc.output();
  assert.ok(output.startsWith('%PDF-'));
  assert.ok(output.trimEnd().endsWith('%%EOF'));
  assert.ok(doc.getNumberOfPages() > 1);
  for (const text of ['QA LEDGER', 'Synthetic QA Finance', '2026-10-05', 'QA-180', '180.00', 'Page 1 of']) assert.ok(output.includes(text), text);
});

test('shared Excel export writes a readable workbook preserving all rows, filters and numeric totals', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'chitfund-exports-'));
  try {
    const filename = join(directory, 'qa-ledger');
    await downloadReportExcel({ filename, title: 'QA Ledger', subtitle: '2026-10-05 to 2026-10-08',
      columns: [{ header: 'Particulars' }, { header: 'Amount', numeric: true }],
      rows: Array.from({ length: 180 }, (_, i) => [`QA-${i + 1}`, i + 1]), summaryRows: [['TOTAL', 16290]] });
    const bytes = readFileSync(`${filename}.xlsx`);
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    const workbook = XLSX.read(bytes);
    const sheet = workbook.Sheets.Report;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    assert.equal(rows[0][0], 'QA Ledger');
    assert.equal(rows[1][0], '2026-10-05 to 2026-10-08');
    assert.ok(rows.some(row => row[0] === 'QA-180' && row[1] === 180));
    assert.ok(rows.some(row => row[0] === 'TOTAL' && row[1] === 16290));
    assert.equal(sheet.B5.t, 'n');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('accounting PDF builders serialize known fixture totals without changing them', async () => {
  const reports = [
    [createTrialBalancePdf, { groups: [], total_debit: 1800, total_credit: 1800 }, 'TRIAL BALANCE', '1,800.00'],
    [createProfitAndLossPdf, { indirect_expense: [], indirect_income: [], gross_profit: 50, net_profit: -70 }, 'PROFIT & LOSS ACCOUNT', '-70.00'],
    [createBalanceSheetPdf, { liabilities: [], assets: [], net_profit: -70, suspense: -250, total_liabilities: 1750, total_assets: 1750 }, 'BALANCE SHEET', '1,750.00'],
  ];
  for (const [builder, fixture, title, total] of reports) {
    const before = JSON.stringify(fixture);
    const doc = await builder(fixture, '2026-10-05', '2026-10-08', profile);
    const pdf = doc.output();
    assert.ok(pdf.startsWith('%PDF-') && pdf.includes('%%EOF'));
    assert.ok(pdf.includes(title));
    assert.ok(pdf.includes(total));
    assert.equal(JSON.stringify(fixture), before);
  }
});
