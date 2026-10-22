# Independent filters and shared KYC layout

Application files changed:
- frontend/src/pages/modules/CustomerReportDetail.jsx
- frontend/src/utils/customerReportSelection.js
- frontend/src/components/SearchableDropdown/SearchableDropdown.jsx and SearchableDropdown.module.css
- frontend/src/components/KycDocuments/KycDocuments.jsx and KycDocuments.module.css
- frontend/src/pages/customers/CustomerFormStepper.jsx
- frontend/src/pages/loans/ChitLoanForm.jsx

QA changes: customerReportSelection.test.js; backend/customer_export_fixture.py; frontend/qa/customer-export fixture/harness/browser; frontend/qa/layout harness/browser.

Customer and loan filters now start enabled. Initially all loans are available; a customer selection narrows the options. Loan selection resolves its linked customer in the same event. Customer changes preserve only a compatible loan. Explicit event handlers avoid synchronization effects/selection loops; only valid loaded customer/loan pairs can fetch or export. Existing effect cleanup discards obsolete responses. Search inside dropdowns is an opt-in mode, preserving other dropdown callers.

Both forms reuse the KYC component's own heading with pending count, two-column proof/attachment controls, a searchable document selector, one Upload button, Camera, accepted-format note, attachment count and compact rows with proof/filename/status/eye/trash actions. File input is explicitly hidden. Dynamic Other, drag/drop, queued uploads, Add Document, camera, previews and secure APIs remain intact. Saved documents have no trash action because the current APIs provide no delete endpoint; pending documents can be removed when the component permits edits. No new API or backend business logic.

Verification:
- 41 frontend tests passed.
- 53 relevant backend tests passed using config.kyc_test_settings (in-memory SQLite), including customer/loan KYC saves, relationships, authorization, validation and report calculations.
- Production build passed, with the existing bundle-size warning.
- Chrome 1440px/390px checks passed: responsive shared KYC, hidden native inputs, exactly one Upload per section, file/drop input, multiple documents, dynamic Other name, pending removal, preview and customer/loan simulated webcam capture/retake/confirm/cancel. Saved status/preview and save refresh verified with a mock API; physical camera hardware was not tested.
- Real isolated Django report fixtures verified both filter orders, inside-dropdown searches, customer switching, automatic linked customer, incompatible loan clearing, valid-pair-only loading and delayed stale-response rejection.
- Actual PDF and XLSX downloads passed after selection changes, period/Show Balance changes and navigation away/return. Grid/export totals matched DR 50, CR 20, closing 30. No report browser console errors.

Artifacts: docs/customer-export-qa-etyo9L (PDF/XLSX), docs/layout-qa (desktop/mobile screenshots).
The third reference image was not attached in this turn, so layout follows the written reference specification; exact image comparison remains unavailable.
No production records changed. No deployment or push.
