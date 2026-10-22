# Excel export formatting verification

The previous SheetJS Community writer preserved numeric data but did not persist the requested cell styling. The shared exporter now uses ExcelJS for actual XLSX fonts, fills, borders, merges, frozen panes, AutoFilter and page setup. All existing Excel report callers retain their own headers, rows, totals and filters. Amount display strings are converted to numeric Excel values with currency formats; DR/CR suffixes are retained in number formats, not in cell values. Counts, percentages and quantities retain appropriate non-currency formats.

Changed application files:
- frontend/package.json and package-lock.json (ExcelJS dependency)
- frontend/src/utils/reportExcel.js
- frontend/src/pages/modules/CustomerReportDetail.jsx, CollectionReport.jsx, LedgerStatement.jsx, MortgageReport.jsx, GroupWiseReport.jsx, TrialBalanceReport.jsx, ProfitAndLossReport.jsx, BalanceSheetReport.jsx
- frontend/src/pages/loans/ActiveLoans.jsx, CompletedLoans.jsx
- frontend/src/pages/collections/TransactionList.jsx, CollectionDashboard.jsx, CollectionEntryPage.jsx

Caller changes only await XLSX generation and make the existing Excel handlers async. No report data producers, accounting calculations, UI layout, APIs, models or records were changed.

Tests and QA files: reportExcel.test.js; phase11Exports.test.js (async completion and scoped module resolution); qa/excel/generate.mjs; qa/customer-export/browser.mjs (numeric balance assertions).

Results:
- 39 frontend tests passed, including XLSX save/reload checks with zero, one and 40 transactions. Confirmed navy/white headers, 16pt navy title, all borders, alignment, merges, numeric amounts and summaries immediately following transactions.
- Production build passed; Vite reports a large-bundle warning.
- Microsoft Excel 12.0 opened all 11 generated QA workbooks read-only. Empty/one/multiple/many customer cases passed. Seven other report-title samples verified shared utility compatibility; these are synthetic utility fixtures, not full screen integrations.
- Chrome downloaded the real Customer-wise component XLSX using the existing isolated application API fixture. Grid and workbook matched: debit 50, credit 20, closing 30. Period filtering, Show Balance, authentication and return navigation passed without console errors.
- Microsoft Excel opened the actual browser-downloaded workbook read-only and confirmed those numeric totals, every data/summary border, title merge, white header text, closing blue fill and print fit.

Artifacts: docs/excel-qa (XLSX and Excel verification JSON), docs/customer-export-qa-tMERjU (browser downloads and screenshot).
No production database access, pushes or deployments.
