# Phase 10 — KYC camera capture

Scope: extend the existing Customer and Loan Application KYC implementation. No accounting/report/schedule logic was changed; no database migrations, record updates, deployment, push, or service changes were performed.

## Existing implementation audited

- The working tree already contained substantial uncommitted Claude changes. They were retained.
- Existing features include customer/loan forms, collections, reports/exports, role controls, customer KYC and loan KYC. No numbered Phase 1–9 specification was found, so those phases cannot be individually certified against their original requirements.
- Customer and loan documents use their existing foreign keys, URL-scoped APIs, shared document choices and CustomerDocumentType registry. Original tests accepted fake image bytes; fixtures now contain real documents.
- Existing camera code lost its video stream on Retake. Existing validators trusted MIME/extension, files used MEDIA_ROOT, and all authenticated users could read KYC.

## Behavior and reuse

Select ID Proof (including Other), Take Photo, allow camera access, Capture, Retake/Cancel or Confirm Photo. Choose File remains available. Preview the selected document and click Add Document for each attachment.

For new Customer/Loan forms, Add Document queues attachments in browser memory. Save Customer/Save uploads them only after the parent record exists. Unconfirmed captures never upload. Pending files are discarded on reset/navigation. Successful uploads are removed from the retry queue. Partial failures retain the parent ID and remaining files; persisted customer fields are frozen and a saved-loan attachment retry screen replaces the editable loan form.

Existing saved-customer/loan KYC sections retain explicit Add Document submission and authenticated View/Download. Camera permission is requested only when Take Photo mounts the camera dialog. The live video stays mounted during preview/Retake. Closing, Cancel, Escape, confirmation or unmount stops tracks. Late permission/encoding results are safely discarded.

New documents are stored outside MEDIA_ROOT at KYC_PRIVATE_ROOT (default backend/private_kyc). The storage has no public URL. Legacy files are read in place through authenticated endpoints; they are not moved. KYC reads/writes require administrator or existing profile can_write permission, and document IDs must match the URL's customer/loan. Responses use no-store and nosniff. This is role-based access; the existing schema has no per-user ownership assignments.

Both serializers share actual image-format verification, matching MIME/extension, 5 MB limit, and PDF header/end-marker validation. PDF checks establish basic format, not malware scanning. Failed document/registry saves roll back database writes and remove the newly stored file. Committed parent/document deletion removes new private files. Legacy files are preserved. Unique upload tokens prevent repeated or simultaneous requests from duplicating an attachment; tokens cannot be reused across parent records or different content.

## Files changed by Phase 10

- .gitignore
- backend/config/settings.py and kyc_test_settings.py
- backend/customers/apps.py, models.py, serializers.py, views.py
- backend/customers/kyc_security.py, kyc_signals.py, kyc_test_files.py
- backend/customers/test_kyc_documents.py, test_kyc_security.py
- backend/customers/migrations/0007_private_kyc_storage.py, 0008_kyc_upload_token.py
- backend/finance/models.py, serializers.py, views.py, test_loan_kyc_documents.py
- backend/finance/migrations/0028_private_kyc_storage.py, 0029_kyc_upload_token.py
- frontend/src/components/KycDocuments/KycDocuments.jsx
- frontend/src/components/KycDocuments/cameraSession.js and cameraSession.test.js
- frontend/src/components/KycDocuments/pendingDocuments.js and pendingDocuments.test.js
- frontend/src/pages/customers/CustomerFormStepper.jsx
- frontend/src/pages/loans/ChitLoanForm.jsx
- docs/PHASE10-KYC.md

Reused: KycDocumentsSection, KycDocumentsModal, document preview, existing upload/list/file APIs, both KYC models and serializers, CustomerDocumentType and document choices, role flags, authenticated axios client, original customer/loan form validation and save payloads.

## Verification and remaining prerequisites

Automated verification runs with config.kyc_test_settings: SQLite in memory, no connection to the configured SQL Server. Tests cover real-file upload/download, parent relationships, all three loan kinds, Other reuse, permissions, private/legacy storage, failed-save cleanup, token replay/concurrent recovery, camera lifecycle/readiness/errors and staged-upload retries. Node tests also cover existing loan schedule payloads. Frontend production build and migration-state consistency checks are run separately.

Final results: 56 backend tests passed; 11 Node tests passed; production build passed (existing large-bundle warning); migration consistency check reported no changes detected. Review findings for upload replay, concurrent stream rewind, queue edits during save, and persisted-field edits on retry were addressed.

Physical desktop/mobile camera interaction and browser form end-to-end testing remain manual. Use HTTPS or localhost, test denied permission, capture/retake/cancel, queue multiple proofs, save, and reopen through authorized detail views.

Before running the updated backend against an existing database, apply the reviewed KYC migrations through the normal release process. Storage migrations update Django state only; token migrations add nullable unique fields to KYC tables. They were not applied here. SQL Server migration execution was not tested.

The live server's existing /media exposure has not been inspected or changed. If legacy KYC directories are publicly served, that must be blocked before calling all historical documents private; this work does not migrate existing files or alter Nginx. KYC_PRIVATE_ROOT must remain outside public web mappings.

Parent customer/loan creation APIs do not have idempotency keys. If the original parent creation commits but its response is lost, verify the customer/loan list before retrying creation; attachment retries are idempotent. Solving parent-create response ambiguity would require a separate change to the existing parent APIs.

Phase 11 was not started.
