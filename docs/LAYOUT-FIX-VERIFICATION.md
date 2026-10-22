# Scoped layout fixes

Changed application files: ChitLoanForm.jsx, loan-application-clean.css, KycDocuments.jsx, KycDocuments.module.css, CustomerReportDetail.jsx, reportPdf.js.

Holiday and Schedule share equal dimensions, padding, typography and borders; SVG chevrons preserve toggles. The shared attachment component now wraps compact controls and retains the existing handlers. Only customer-wise PDF opts into a last-page table footer that reserves space for all three summary rows; other reports and Excel keep their existing behavior.

Validation: production frontend build passed (existing chunk-size warning). All 35 frontend tests passed, including eight PDF footer cases spanning 1/27/28/29/60/180 rows and the actual six/seven-column customer layouts, column alignment and DR/CR values. Isolated Chrome checks passed at 1440px and 390px: equal header geometry, no KYC control overflow, Interest/Chit toggles, customer/loan shared camera, capture/retake/confirm/cancel/preview, local file selection, drag-drop, Other field and multiple pending attachments. Camera used simulated devices; API fixture prevented database writes. Physical mobile camera and production server upload were not exercised.

QA harness: frontend/qa/layout. Screenshots and generated multi-page PDFs: docs/layout-qa. No APIs, accounting logic, Excel exports or databases changed. No push or deployment.
