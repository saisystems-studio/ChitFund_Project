# Bank Deposit Transaction Implementation Plan

Implement inline under the user-approved requirements, without changing existing records.

- [x] Add failing API tests for Deposit/Withdrawal, validation, CRUD, permissions, history and accounting.
- [x] Add BankTransfer model/migration and finance-permission API with protected ledger foreign keys and server-generated vouchers.
- [x] Include transfer debit/credit legs in existing accounting balances and Cash/Bank statements, preserving existing posting rules.
- [x] Add compact responsive form and separate searchable/filterable/paginated history with Excel/PDF/Print; register routes and Transactions navigation.
- [x] Run isolated SQLite backend tests, frontend unit tests and build. Browser viewport tests require a connected browser; report untested checks honestly.

Ruling: Amounts are posted through derived report balances, as existing transactions are; Ledger opening balances are never mutated. Voucher BD/ BW numbers use persisted IDs for concurrency-safe uniqueness. Existing finance rules control Entry and administrator-only Edit/Delete.


Verification: 27 selected backend tests passed on isolated SQLite, including existing accounting, collection account, payment group and client-requirement tests. Two frontend tests passed and the full production build passed. Migration model-state check found no changes; 0034 applied independently and persisted a transfer in an isolated database. Historical migrations contain SQL Server-specific SQL, so the entire historical chain cannot run on SQLite.

- [ ] Apply 0034_bank_transfer in the configured live database before using the module. No live records or schema were changed during implementation.
- [ ] Browser QA at 375px, 768px, 1366px and 1920px, including form Save/Reset/Edit/Delete and exports. No connected browser is available in this session.
