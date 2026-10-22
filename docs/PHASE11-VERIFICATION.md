# Phase 11 verification — 8 October 2026

Readiness: **VERIFICATION INCOMPLETE**. Automated isolated checks pass, but mandatory SQL Server, browser/device, per-report export and deployed-storage checks remain unverified. Do not deploy based only on this report.

## Evidence and scope

- Full Django suite: **150 tests passed**, using `config.kyc_test_settings` (SQLite in memory). This is not proof of SQL Server behavior or migration execution; business-app migrations are disabled in this test configuration.
- All existing/new Node tests: **27 passed**. Tests run actual PDF builders and write/read an actual XLSX in a temporary directory; temporary artifacts are removed.
- Production frontend build: **passed**, with an existing bundle-size warning (main JavaScript about 1.41 MB).
- `pip check`: `No broken requirements found.`
- Django system check: `System check identified no issues (0 silenced).`
- Migration/source consistency: dry-run `makemigrations --check` against isolated settings with migration loading enabled: `No changes detected`. No migrations applied.
- Lint unavailable: `npm error Missing script: "lint"`.
- Deployment check: five warnings, listed below. Current local configuration is not a verified production configuration.
- Existing dirty Git tree and Claude changes retained. No push/pull/merge/deployment, services, Nginx, database records or accounting formulas changed.
- Numbered original Phase 1–9 specification is absent; implementation exists but historical phase completion cannot be individually certified.

Commands: `backend/.venv/Scripts/python.exe manage.py test --settings=config.kyc_test_settings --noinput`; `node --test src/utils/*.test.js src/components/KycDocuments/*.test.js`; `npm.cmd run build`; `python -m pip check`; Django `check`, `check --deploy`, and dry-run migration consistency check.

## Feature verification matrix

PASS applies only to the stated automated scope, never to an entire browser workflow inferred from source.

| Feature | Status | Test Result | Issues | Fix Applied |
|---|---|---|---|---|
| Backend health/dependencies | PASS | Full suite, dependency and system checks pass | Production differs from test settings | None |
| Frontend compilation | PASS | Final production build passes | Large bundle warning | Removed malformed duplicate Trial Balance TOTAL row |
| Frontend lint | BLOCKED | Missing lint script | No configured linter | None |
| Reports sidebar | NOT TESTED | Source has required General/Loan/Accounts categories and names | Active highlighting/collapse/back navigation not browser-tested | None |
| Today Collection Report date calculations | PASS | Existing due/partial/paid/future/filter tests plus historical-date regression pass | Per-installment output; earliest-unpaid loan-level interpretation across loan kinds not independently certified | Use selected report date for row overdue calculations |
| Today Collection History | NOT TESTED | Local-date defaults/filtering/export code inspected; collection tests pass | Complete report workflow and totals not browser-tested | None |
| Payment History | NOT TESTED | Payment/ledger integration tests pass | All filters/voucher display/export clicks untested | None |
| Admin/normal-user permissions | PASS | Existing role tests and token-based PUT/PATCH/DELETE/custom schedule/user-management denial tests pass | Exhaustive custom-action and frontend controls audit incomplete | Added regression coverage; existing schedule restriction already correct |
| Customer-wise report API | PASS | Opening balances, Dr/Cr rows/totals, voucher types, loan/customer filters and real collection tests pass | Show Balance/navigation reset/export interaction not browser-tested | None |
| Group-wise report API | PASS | Existing isolated group-wise fixtures pass | Browser and export workflow untested | None |
| Accounting APIs/calculations | PASS | Trial Balance 1800 Dr=Cr; P&L net loss 70; Balance Sheet assets=liabilities 1750 in known fixtures | These are isolated fixture checks, not a live-books reconciliation | None |
| Customer KYC API/storage | PASS | Real synthetic upload, types, scope, auth, content/size, private/legacy reads, cleanup and retry tests pass | Form/browser end-to-end untested | None in Phase 11 |
| Loan KYC API | PASS | Chit/Interest/Mortgage uploads, relationships, customer-doc preservation, token retries and access tests pass | All three UI capture/save flows untested | None in Phase 11 |
| Camera lifecycle/error handling | PASS | Mocked readiness, Retake, Cancel, late streams/encoding and permission-error tests pass | Hardware/device claims excluded | None |
| Desktop/mobile camera hardware | NOT TESTED | No physical-device verification | Requires supported browser and HTTPS/localhost | None |
| Document privacy in deployed server | NOT TESTED | New storage exposes no URL; scoped API tests pass | Historical media may be served publicly; Nginx/live mapping untouched | None |
| Existing loan schedules/collections/payments | PASS | Existing isolated creation/edit/preservation/mortgage/collection/payment fixtures pass | Browser CRUD and SQL dialect differences unverified | No formulas/postings changed |
| Authentication | PASS | Existing normal/temp-token tests pass; new real-token permission tests pass | Logout is frontend token clearance; server token revocation is not implemented | None |
| Dashboard, all masters, responsive UI, reset/toasts/dropdowns | NOT TESTED | Build and available API tests pass | No complete browser interaction suite run | None |
| SQL Server migration history | PASS | Approved read-only retry succeeded; all listed migrations marked [X], including customer 0007/0008 and finance 0028/0029 | History is not a physical-schema or migration-execution test | None |
| Live/production-like data integrity | NOT TESTED | No live CRUD performed; isolated relations tested | Migration history inspected read-only; physical schema, orphan/duplicate/missing records not inspected | None |

## Report export validation matrix

These are browser-generated files, not server export endpoints: HTTP response/MIME checks do not apply to the file generators. Authenticated source-data API checks and generated-file validation are separate.

| Report | PDF Status | Excel Status | Data Accuracy | Issues |
|---|---|---|---|---|
| Today Collection Report | NOT TESTED | NOT TESTED | Due-day API fixtures passed | Report-specific button/data wiring untested |
| Today Collection History | NOT TESTED | NOT TESTED | Collection API fixtures passed; full history not certified | Report-specific output untested |
| Payment History | NOT TESTED | NOT TESTED | Posting fixtures passed | Report-specific output untested |
| Customer-wise | NOT TESTED | NOT TESTED | Ledger fixtures passed | Actual selected-filter output untested |
| Group-wise | NOT TESTED | NOT TESTED | Group fixtures passed | Actual selected-filter output untested |
| Active Loans | NOT TESTED | NOT TESTED | Loan fixtures passed | All matched pages and output untested |
| Completed Loans | NOT TESTED | NOT TESTED | Full report unverified | Report-specific output untested |
| Mortgage Report | NOT TESTED | NOT TESTED | Mortgage integration fixtures passed | History export untested |
| Cash Ledger | NOT TESTED | NOT TESTED | Accounting/collection fixtures passed | Independent ledger/export reconciliation incomplete |
| Bank Ledger | NOT TESTED | NOT TESTED | Payment/accounting fixtures passed | Independent ledger/export reconciliation incomplete |
| Pending & Outstanding | NOT TESTED | NOT TESTED | Pending-filter/pagination utilities passed | Report-specific output untested |
| Trial Balance | PASS (builder fixture) | NOT TESTED | Balanced accounting fixtures passed | PDF totals/title validated; selected page export not triggered |
| Profit & Loss | PASS (builder fixture) | NOT TESTED | Known income/expense fixture passed | PDF totals/title validated; selected page export not triggered |
| Balance Sheet | PASS (builder fixture) | NOT TESTED | Balanced accounting fixture passed | PDF totals/title validated; selected page export not triggered |
| Shared generic report helper | PASS | PASS | Synthetic 180-row fixture preserved; Excel total 16290 | Does not certify every page adapter |

Actual helper verification: nonempty `%PDF-` / `%%EOF`, multi-page output, company text, report heading, filters, final data row, pagination footer; XLSX ZIP signature, workbook reopening, title/filters, final row, numeric cell and total. Accounting PDF builders preserve input fixtures and output expected totals. Existing receipt/payment tests verify A4 margins, signatures and long-content handling. Company logo rendering, every report adapter, independent PDF parser validation, real download MIME/browser interactions and all financial exports remain manual/unverified.

## Confirmed defects and minimal fixes

1. Historical report date did not control Due Days. New test reproduced `AssertionError: 3 != 0` for an installment due on the selected historical date. `collections_list` previously passed today's local date; it now passes selected_date in both exact-date and previous branches. No stored dates, amounts or accounting formulas changed. Final regression suite passes.
2. During verification the active Trial Balance file acquired a malformed duplicate TOTAL row. Build failed: `Expected } but found )`, `TrialBalanceReport.jsx:72:116`. Removed only that duplicate row, preserving the valid debit/credit TOTAL row. Final build passes. The file changed during checking; earlier patch attempts correctly refused mismatched context.

Read-only reviewer found no important regressions in these final changes.

## Complete Phase 11 changed-file list

- backend/finance/views.py — selected report-date calculation fix only.
- backend/finance/test_today_report_due_days.py — historical-date regression.
- backend/accounts/test_phase11_permissions.py — real-token permission coverage.
- frontend/src/pages/modules/TrialBalanceReport.jsx — malformed duplicate row removed.
- frontend/src/utils/phase11Exports.test.js — actual synthetic PDF/XLSX validation.
- docs/PHASE11-VERIFICATION.md — this report.

Phase 11 introduces **no migrations, API routes, payload changes, permission changes or dependencies**. The approved read-only SQL Server showmigrations check recorded every listed migration as applied, including customers 0007/0008 and finance 0028/0029. This agent did not apply them. Migration history does not independently verify physical schema correctness or certify executing migrations on a clean SQL Server test database.

## Unresolved errors and deployment risks

- SQL Server read-only migration-status connection: `08001`, `Encryption not supported on the client`, `SSL Provider: No credentials are available in the security package`, `Client unable to establish connection`, `Invalid connection string attribute`, and `Server is not found or not accessible`. The approved unrestricted read-only retry succeeded; the original failure was limited to the sandbox environment. All listed migrations were marked applied. No database writes or migration execution were attempted.
- Django deployment warnings: `security.W004` SECURE_HSTS_SECONDS unset; `W008` SECURE_SSL_REDIRECT not enabled; `W009` SECRET_KEY insufficient length/variety; `W012` SESSION_COOKIE_SECURE not enabled; `W016` CSRF_COOKIE_SECURE not enabled. Secrets are not reproduced here. Resolve in the actual production environment after reviewing proxy/TLS settings; local development settings are not proof of live configuration.
- Lint: `Missing script: "lint"`. No lint PASS claimed.
- SQL Server semantics and migrations are not certified by SQLite tests. No historical record deletion/schema integrity assertion can be made without an approved read-only database inspection and baseline comparison.
- Existing media mappings may expose historical government IDs. Verify/block legacy KYC paths before release without relocating production files automatically.
- Camera hardware and browser workflows/export clicks are NOT TESTED. Browser business-date defaults use the device timezone; cross-timezone behavior is unverified.
- Parent customer/loan creation still lacks server idempotency for a response lost after commit. Document retry tokens prevent attachment duplicates; verify parent list before retrying ambiguous creation.
- Authorization is role-based and entity-scoped; no per-user ownership model exists. Exhaustive authorization of every custom endpoint remains incomplete.
- No dependency vulnerability audit or independent reconciliation of production books was performed. No safety or accounting certification is implied by passing fixtures.

## Recommended release and rollback checklist (not executed)

1. Review the complete dirty-tree diff and pending migrations; preserve source and database/media backups in the approved release process.
2. Verify SQL Server connection, applied migrations and read-only integrity queries for foreign keys/orphans/duplicate postings. Re-run on an isolated SQL Server database with real migrations and synthetic data.
3. Configure production secrets/TLS/cookies/proxy settings; disable temporary development login; verify public media restrictions and private-root permissions.
4. Complete browser regression for admin and entry/view roles, all report buttons/filters/outputs, all customer/loan document flows, physical desktop/mobile capture and responsive navigation.
5. Independently reconcile exported financial totals, opening balances, earliest applicable unpaid due dates for each loan kind and all paginated matching records.
6. Approve a release explicitly only after remaining gates pass; deploy manually through the established process, with post-release read-only smoke checks.
7. On failure, stop new writes through the approved operational process; restore the prior application artifact/config. Retain reviewed compatible additive schema/private files unless a separately approved rollback is required. Never blindly unapply migrations, delete KYC files or restore financial data over newer transactions.

No further feature development or deployment was performed.
