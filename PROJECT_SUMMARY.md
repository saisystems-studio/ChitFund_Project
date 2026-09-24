# CHITUFUND — Project Summary

> Source review: 24 September 2026. Describes the current source code, not a proposed design. Features marked implemented have code behind them; this review did not run the application, connect to SQL Server, or execute the test suites. No environment secrets are reproduced.

## 1. Overview and purpose

CHITUFUND is a finance collection management application, branded **Finance Collection** in the UI. It maintains customers, reusable chit installment plans, interest loans, mortgage products and loans, holiday rules, repayment schedules, and collections. Staff use a React interface backed by authenticated Django REST APIs and Microsoft SQL Server.

The central workflow is **configure masters → create customer → create loan → generate installments → collect payments → review pending/outstanding/history reports**. Customer roles are stored as `BORROWER`, `LENDER`, or `BOTH`; the UI generally labels them Debtor, Creditor, and Both. The implemented chit functionality is a group template and customer loan schedule system; there is no auction, bidding, subscriber-seat, or dividend distribution implementation.

## 2. Technology stack

| Layer | Implemented technology |
|---|---|
| Frontend | React, React DOM, JavaScript/JSX, Vite, `@vitejs/plugin-react` |
| UI/state/navigation | CSS and CSS Modules; React hooks; browser History API; local/session storage. No React Router or external state-management library declared. |
| HTTP | Axios; token header sent to the Django API |
| PDF | `jspdf` `^4.2.1`, `jspdf-autotable` `^5.0.8`; browser printing for reports |
| Backend | Django `5.2.17`, Django REST Framework `3.16.1` |
| Integration | `django-cors-headers` `4.9.0`, `django-filter` `25.2`, `python-dotenv` `1.2.3` |
| Database | Microsoft SQL Server via `mssql-django` `1.7.4`, `pyodbc` `5.3.0`; Windows integrated authentication |
| Workbook import | `openpyxl` `3.1.5` for location master import |
| Tests | Django test classes; Node built-in test runner for date/schedule payload utilities |

`backend/requirements.txt` records validation with Python 3.13. Most frontend dependencies use `latest` in `package.json`; the committed `package-lock.json` records resolved versions. Scripts are `dev`, `build`, and `preview`; there is no npm test or lint script.

## 3. Folder and module structure

The following covers all application folders and executable source modules. Companion CSS files are grouped to keep the map readable; generated dependencies, bytecode, build output, and Git internals are not expanded.

```text
CHITUFUND/
├── .gitignore
├── README.md
├── PROJECT_SUMMARY.md
├── backend/
│   ├── .env                         Local configuration, ignored by Git
│   ├── .venv/                       Local Python environment, ignored
│   ├── manage.py
│   ├── requirements.txt
│   ├── config/
│   │   ├── __init__.py
│   │   ├── settings.py              Apps, SQL Server, auth, CORS, pagination
│   │   ├── urls.py                  /admin/, /api/, /api/auth/, /api/finance/
│   │   ├── asgi.py
│   │   └── wsgi.py
│   ├── accounts/
│   │   ├── __init__.py, apps.py, admin.py
│   │   ├── models.py                UserProfile
│   │   ├── serializers.py           Login and user-account payloads
│   │   ├── permissions.py           CanWriteFinanceData
│   │   ├── temporary_auth.py        Development tokens + normal DRF tokens
│   │   ├── views.py, urls.py        Login, current user, account CRUD
│   │   ├── test_temporary_auth.py
│   │   ├── migrations/              __init__.py, 0001_initial.py
│   │   └── management/commands/     create_default_admin.py; package initializers
│   ├── customers/
│   │   ├── __init__.py, apps.py, admin.py
│   │   ├── models.py                Customer and country/state/district masters
│   │   ├── serializers.py           Customer normalization and validation
│   │   ├── views.py, urls.py        CRUD, search, code preview, locations, counts
│   │   ├── migrations/              __init__.py, 0001_initial.py,
│   │   │                           0002_location_masters.py
│   │   └── management/commands/     import_location_master.py; package initializers
│   └── finance/
│       ├── __init__.py, apps.py
│       ├── models.py                Finance masters, loans, installments, collections
│       ├── serializers.py           Model serializers and calculated response fields
│       ├── services.py              Schedule generation and payment-preserving edits
│       ├── views.py, urls.py        Finance CRUD, collection actions, reports
│       ├── test_preview_schedule.py
│       ├── test_requested_fixes.py
│       ├── test_mortgage_quantity.py
│       └── migrations/              __init__.py; 0001–0013 (see below)
└── frontend/
    ├── .env, .env.example           API base URL; local .env ignored
    ├── package.json, package-lock.json
    ├── index.html, vite.config.js
    ├── node_modules/, dist/         Local dependencies/build output, ignored
    └── src/
        ├── main.jsx                React mount, global styles, table scrolling
        ├── App.jsx                 Auth/session shell, routes, dashboard, customer list
        ├── styles.css
        ├── assets/images/          work-progress.png
        ├── data/                   indiaLocationMaster.js
        ├── hooks/                  useFormKeyboardNavigation.js
        ├── components/
        │   ├── CustomSelect.jsx, DistrictDropdown.jsx, Tooltip.jsx
        │   ├── ListPageLayout.jsx, ListPageToolbar.jsx, RowActions.jsx
        │   ├── PageBreadcrumb.jsx
        │   ├── SearchableDropdown/ SearchableDropdown.jsx + CSS Module
        │   ├── Sidebar/            Sidebar.jsx, AdminMenu.jsx + CSS Modules
        │   └── Companion CSS       DistrictDropdown.css, PageBreadcrumb.css
        ├── pages/
        │   ├── auth/               Login.jsx + Login.module.css
        │   ├── customers/          CustomerFormStepper.jsx, CustomerEdit.jsx
        │   │                       (also exports CustomerView) + form/edit CSS
        │   ├── masters/
        │   │   ├── LoanTypeSetup.jsx + CSS
        │   │   ├── MortgageMaster.jsx, MortgageEditModal.jsx + CSS
        │   │   └── chitGroup/      ChitGroupList.jsx, ChitGroupForm.jsx
        │   │                       + CSS Modules and form/list overrides
        │   ├── loans/              ChitLoanForm.jsx, ActiveLoans.jsx,
        │   │                       LoanDateInput.jsx + workflow/detail/layout CSS
        │   ├── collections/        CollectionEntry.jsx, CollectionEntryPage.jsx,
        │   │                       CollectionDashboard.jsx + collection CSS
        │   └── modules/            ModulePages.jsx, HolidayMaster.jsx,
        │                           CollectionReport.jsx, WorkInProgress.jsx + CSS
        ├── styles/                 Global/theme, responsive layout, navigation/sidebar,
        │                           dashboard, customers, forms/validation, lists/tables,
        │                           toolbars/actions, tooltips and override stylesheets
        └── utils/                  actionToast.js, confirmDelete.js, currency.js,
                                    chitPdf.js, loanDateDisplay.js,
                                    loanSchedulePayload.js,
                                    loanSchedulePayload.test.js, tableScrolling.js
```

Finance migrations: `0001_initial`, `0002_chitgroup_total_amount`, `0003_seed_collection_types`, `0004_remove_chitgroup_total_amount`, `0005_loantype_allowed_installment_ids`, `0006_loantype_yearly_rule`, `0007_collectiontransaction`, `0008_adjustmenttypemaster_and_more`, `0009_mortgage`, `0010_mortgageunit_chitgroup_collection_date_and_more`, `0011_chitgroup_end_date`, `0012_interestdetails_duration_type`, `0013_mortgage_quantity`.

The collection-frequency migration seeds Daily, Weekly, Monthly, Annual, 100 Days, and Other. Loan-type API reads ensure the fixed Chit, Interest, and Mortgage records exist. Finance models are not registered in a finance `admin.py`; customer and user-profile admin registrations exist.

## 4. Frontend pages and UI flow

`App.jsx` resolves paths manually using `pushState` and `popstate`. Unknown paths fall back to the dashboard. Authentication wraps the entire application. The shell provides expandable/collapsible sidebar navigation, mobile navigation, light/dark appearance, profile/settings popups, and logout.

| Route | Current page and behavior |
|---|---|
| `/login` | Username/password form, visibility toggle, loading and error feedback |
| `/dashboard` | Customer/loan/collection cards, expected-versus-collected chart, attention items, recent payments and shortcuts; field-mapping limitations below |
| `/masters` | Links to customer, chit, mortgage, holiday and loan-type setup |
| `/customers` | Search, alphabetic customer list, mobile cards, detail navigation, edit and delete; footer pagination is decorative |
| `/customers/new` | Customer form with inline validation, location suggestions, WhatsApp copy option, draft retention, reset/cancel/save |
| `/customers/:id` | Customer detail component exists, but current route omits its required `id` prop and redirects back to the list |
| `/customers/:id/edit` | Loads and PATCHes a customer; reset restores loaded values |
| `/chit-groups` | Search/list, detail dialog, edit, delete, activation toggle, PDF download |
| `/chit-groups/new`, `/chit-groups/:id/edit` | Group dates/duration, entered chit amount, editable installment amounts, saved drafts and keyboard amount navigation |
| `/loan-types` | Setup modal over the dashboard; edit supported periods and yearly date rules for the three fixed types |
| `/collection-types` | Generic list with edit/delete for installment-frequency masters; no creation UI wired here |
| `/mortgage-master` | Product search, add/edit/delete, unit creation, quantity/rate/date inputs and dated rate history |
| `/holiday-master` | Year/month/type/status/search filters; month lists and calendar; add/edit/delete persisted holidays; displays calculated Sundays and fallback holidays |
| `/loan-application`, `/loan-application/:id/edit` | Shared form with separate Chit, Interest and Mortgage layouts; customer/type selection, calculations, previews, draft/reset and save |
| `/active-loans` | Loan list/search, detail dialog with installments, edit and delete |
| `/today-collection` | `CollectionEntryPage.jsx`: date navigation, pending/partial filters, prior dues, summary panel and link to collect |
| `/collection-entry` | `CollectionEntry.jsx`: customer → loan → amount/payment mode → installment selection and allocation preview → save |
| `/collection-report`, `/pending-collection`, `/reports/collections/pending` | Pending installment report |
| `/outstanding-report`, `/reports/collections/outstanding` | Loan-wise outstanding report |
| `/collection-history`, `/reports/collections/history` | Collection transaction history |
| `/reports/daily`, `/reports/cash-balance`, `/reports/bank-balance` | Explicit work-in-progress screens |

Reports include date/status/loan/customer-type controls, customer autocomplete, detail dialogs, performance panels, numeric/histogram display and a PDF-labelled print button. Some controls and response fields are not aligned with the backend; see known issues.

Customer, chit-group and loan creation forms store drafts in `sessionStorage`. Session, theme, sidebar preference and last activity use `localStorage`. Location dropdowns use bundled `indiaLocationMaster.js`, independently of the backend location-search endpoints. Shared utilities handle INR formatting, deletion confirmation, feedback, date conversion and table scrolling.

## 5. Backend architecture, APIs and CRUD

`config/urls.py` mounts customers at `/api/`, accounts at `/api/auth/`, finance at `/api/finance/`, and Django admin at `/admin/`. DRF defaults to authenticated requests and page-number pagination of 15. Finance pagination accepts `page_size`, capped at 10,000; customer and several master viewsets disable pagination.

### API reference

For standard viewset resources, collection URLs support GET/POST and `/<id>/` supports GET/PUT/PATCH/DELETE, subject to the exceptions below. All paths include trailing slashes.

| API path | Operations and purpose |
|---|---|
| `/api/auth/login/` | POST credentials; returns token and user flags; allows anonymous requests |
| `/api/auth/me/` | GET current user |
| `/api/auth/users/` | Admin-only account CRUD; queryset excludes superusers |
| `/api/customers/` | Customer CRUD; lists active records, filters role/search, forces case-insensitive name ordering |
| `/api/customers/next-code/` | GET proposed next `CUS_###` code |
| `/api/customers/search/?q=...` | GET up to ten active matches; minimum two characters |
| `/api/dashboard/` | GET active customer counts by role |
| `/api/districts/`, `/api/locations/` | GET database-backed location suggestions; `locations` accepts `type` and `q` |
| `/api/finance/loan-types/` | Read/configure fixed loan types; POST returns 405; fixed types cannot be renamed, disabled or deleted |
| `/api/finance/loan-installments/` | Installment-frequency master CRUD |
| `/api/finance/mortgages/` | Mortgage product CRUD and serialized rate history |
| `/api/finance/mortgages/units/` | GET available unit names; POST a custom unit |
| `/api/finance/chit-groups/` | Group CRUD with nested template rows; active groups listed first |
| `/api/finance/chit-group-installments/` | Template row viewset; nested group editing is the working creation path because serializer `group` is read-only |
| `/api/finance/loans/`, `/api/finance/customer-loans/` | Aliases for loan CRUD; create/update branches by type; lists active loans and supports `customer` filter |
| `/api/finance/loans/<id>/generate-schedule/` | POST regenerate a Chit loan schedule; also available on the alias |
| `/api/finance/interest-details/`, `/api/finance/customer-chit-details/` | Direct subtype-detail CRUD |
| `/api/finance/customer-loan-installments/`, `/api/finance/due-schedules/` | Aliases for installment CRUD |
| `/api/finance/customer-loan-installments/<id>/collect/` | POST payment allocated oldest-first across that loan; also available on the alias |
| `/api/finance/holidays/`, `/api/finance/loan-holiday-settings/` | Holiday and per-loan override CRUD |
| `/api/finance/chit-loans/preview-schedule/` | POST non-persistent Chit due-date preview |
| `/api/finance/adjustment-types/` | GET active types; POST case-insensitive get-or-create |
| `/api/finance/collections/` | GET due balances by date/prior range; POST payment to one installment |
| `/api/finance/collections/create/` | POST alias for one-installment payment |
| `/api/finance/collections/summary/` | GET today-due/collected/remaining, yesterday-pending and overdue totals |
| `/api/finance/collections/previous-pending/` | Registered helper for prior dues; request-wrapper defect noted below |
| `/api/finance/collection-history/` | GET transactions; filters date range, search, payment mode and current installment status |
| `/api/finance/payments/` | GET compatibility response synthesized from installment paid totals, not a transaction ledger |
| `/api/finance/reports/day-wise/`, `/api/finance/reports/loan-wise/` | GET installment and loan-grouped reports; filters `from`, `to`, `search`, `loan_number`, `customer_id`, `customer_type`, `status` |
| `/api/finance/reports/customer/<id>/` | GET customer loans, unpaid/received schedules and summaries; returns 404 if customer has no loans |

Deletion is generally **physical deletion**, not deactivation. Protected relations return HTTP 409 through customer/finance destroy handlers. Chit groups also support a separate `is_active` toggle. Direct subtype/installment APIs expose model CRUD and do not automatically perform every recalculation in the main loan workflow.

### Serializers and validation

- `LoginSerializer` accepts username/password. `UserAccountSerializer` creates hashed passwords, manages `UserProfile`, and allows account updates; supplied passwords have a four-character minimum.
- `CustomerSerializer` trims/normalizes names; validates ten-digit phone numbers, optional twelve-digit Aadhaar, PAN format, six-digit pincode, nonnegative income, nonfuture DOB and address length. Full writes require name, role, phone, address, district and state; country defaults to India. Empty DOB becomes null and the WhatsApp copy flag copies the primary phone. Primary mobile and customer code are unique.
- `LoanTypeSerializer` translates allowed installment IDs between JSON text storage and arrays, validates active referenced IDs, and protects fixed type names/activation.
- `MortgageSerializer` requires a positive supplied rate and its date; a different rate for an existing product/date is rejected atomically. `current_rate` tracks the latest dated rate. Quantity is optional on the product master.
- `ChitGroupSerializer` exposes nested rows and `template_installments`, accepts `total_amount` as the input alias of `grand_total`, calculates first collection date, validates collection month/day, and checks submitted row count equals duration. It does not require template amounts to sum to the entered chit amount.
- `CustomerLoanDetailsSerializer` expands customer/type/plan, subtype values, installments, collected amount, balance, next due and calculated status. These response shapes differ from raw model foreign-key inputs.
- `CustomerLoanInstallmentDetailsSerializer` adds paid/balance/status/overdue fields, preferring transaction totals when present. Other finance serializers largely expose all model fields with DRF's generated validation.
- Main loan views check required customer/product/group values, date parsing and positive Interest/Mortgage amounts, rates and durations. Preview rejects invalid ISO dates and unsupported schedule inputs. Validation is not equally strict on every direct model endpoint.

## 6. Database structure and relationships

The schema uses Django ORM models with explicit legacy table/column names for most business records. Monetary amounts generally use `Decimal(18,2)`; mortgage quantity uses three decimal places and percentages generally use `Decimal(8,3)`. `AuditModel` supplies creator/modifier text fields and timestamps to most finance records; user names are not foreign keys or automatically stamped by the views.

| Model / table | Main data and relationships |
|---|---|
| Django `User` / `auth_user`; `UserProfile` / `accounts_userprofile` | Credentials and staff/superuser flags; one-to-one profile with `can_write`, `display_role`. Normal tokens use `authtoken_token`. |
| `CountryMaster`, `StateMaster`, `DistrictMaster` | Country → states → districts; protected parent FKs; country name unique, state unique within country, district unique within state; optional district pincode |
| `Customer` / `Customer_tbl` | Code, name, DOB, gender, occupation, income, contact/WhatsApp/email, role, address/location strings, Aadhaar/PAN, active flag and audit fields. Location strings are not FKs to location masters. |
| `LoanType` / `LoanType_tbl` | Unique name, active flag, allowed installment IDs as JSON text, repeat type/month/day; IDs are not a database many-to-many relation |
| `LoanInstallment` / `LoanInstallment_tbl` | Unique installment-frequency name/code and active flag |
| `ChitGroup` / `ChitGroup_tbl` | Unique code, name, duration unit/count, start/collection/end dates, recurring day/month, grand total and active flag |
| `ChitGroupInstallmentDetail` / `ChitGroup_InstallmentDetails_tbl` | Many template rows per group; sequence, schedule label and amount; unique group/sequence |
| `CustomerLoanDetails` / `CustomerLoanDetails_tbl` | Protected customer/type FKs; unique loan number, principal, start/end, total/paid/penalty/outstanding, status and active flag |
| `InterestDetails` / `InterestDetails_tbl` | One-to-one loan; protected frequency FK; principal, flat rate/interest/total, duration unit/count, collection rules, installment totals, grace/penalty fields |
| `CustomerChitDetails` / `CustomerChitDetails_tbl` | One-to-one loan, protected group FK and include-Sunday flag |
| `Mortgage` / `Mortgage_tbl` | Unique product name, optional quantity, unit string, current rate, active flag |
| `MortgageRate` / `finance_mortgagerate` | Product FK, date, rate; unique product/date |
| `MortgageUnit` / `finance_mortgageunit` | Unique reusable unit name; product unit remains a string |
| `MortgageLoanDetails` / `MortgageLoanDetails_tbl` | One-to-one loan, protected product FK; snapshot name/unit/rate, quantity, market value, loan amount, percentage and daily interest |
| `CustomerLoanInstallmentDetails` / `CustomerLoanInstallmentDetails_tbl` | Many rows per loan; sequence, due date, amount, paid/penalty/outstanding, payment status/date; unique loan/sequence |
| `HolidayMaster` / `HolidayMaster_tbl` | Unique date, name/type, region, description and active flag |
| `LoanHolidaySettings` / `LoanHolidaySettings_tbl` | Loan-to-holiday mapping with include-in-schedule flag; unique loan/holiday |
| `CollectionTransaction` / `CollectionTransaction_tbl` | Protected installment, loan and customer FKs; amount/date/mode, reference, remarks, UPI/bank/cheque details, adjustment type/amount and discount |
| `AdjustmentTypeMaster` / `AdjustmentTypeMaster_tbl` | Unique name, active flag and audit fields; transaction adjustment type is stored as text |

Loan subtype rows, installments and holiday mappings cascade when a loan is deleted; template rows cascade with a group and rate rows with a product. Transaction `PROTECT` relations prevent deletion of referenced installment/loan/customer records. No constraint enforces that a loan has exactly one of the three subtype rows; the main create/update workflow supplies that convention.

## 7. Business logic by module

### Customers and master records

Customer codes use `CUS_` plus the next value derived from the highest existing customer ID. Group codes use `CHG_` plus one above the highest existing matching suffix. Loan numbers combine the customer ID and current loan count plus one: `LN_<customer:06d>_<count+1:06d>`. These are application-generated values, not independent sequence objects.

Chit templates have one row per duration unit. Group save replaces template rows transactionally, retaining an explicitly entered chit amount; if it is zero, the backend falls back to the row sum. Editing a group alone does not regenerate existing customer schedules.

### Chit loans and holidays

`finance/services.py` generates DAY, MONTH and YEAR schedules. Monthly/yearly dates clamp to the last valid day of the month; the first recurring date is on or after the loan start. Excluded dates move forward, preserving row count and increasing due dates.

Persisted Chit schedules copy amounts from group templates. Active master holidays are blocked by default; loan holiday selections with `include_in_schedule=True` permit collection on those dates. Sunday collection is configurable, including explicitly included Sunday overrides. The loan end date becomes the final generated due date, and loan total becomes the sum of copied installment amounts.

Preview accepts explicit blocked dates and does not save records. The UI's default holiday display is not an external government-calendar integration: it contains hardcoded fallback dates. Only persisted master holidays participate in backend scheduling.

### Interest loans

Interest is flat for the entire entered principal: `interest = principal × percentage / 100`; `total = principal + interest`. Duration is used as installment count, not as a rate multiplier. The backend supports Daily/100 Days, Weekly, Monthly and Annual/Other(s) recurrence paths. Installment division is rounded to cents and the last row absorbs the rounding remainder.

The current interest schedule service does not apply its `include_sunday` argument or holiday exclusions. Grace and penalty configuration fields exist in the model, but no automatic penalty-accrual or compound-interest engine is implemented.

### Mortgage loans

The product master stores dated rates. A loan snapshots product name, unit and rate, calculates `market value = quantity × rate`, and calculates `daily interest = loan amount × percentage / 100 / 365`. Editing the same product preserves the loan's original rate; changing product uses the selected product's current rate.

The implemented repayment schedule is **one installment due the day after start, for principal plus one day's interest**. There is no ongoing daily accrual, collateral release or foreclosure workflow.

### Loan edits and schedule preservation

`save_installments_preserving_payments()` matches existing installments by sequence within an atomic transaction and locks them for update. It preserves IDs and recorded payments, refuses to remove rows with payments/penalties/transactions, and refuses to reduce an amount below recorded payments after accounting for existing penalty. Loan workflows then update totals/end dates. Recalculation is not a universal model hook.

### Collections

There are two materially different payment paths:

1. **Loan-wide collect action**, used by the active collection-entry screen: validates amount/date, allocates to oldest unpaid installments, stores one transaction against the first affected installment, updates installment balances/statuses and loan totals, and marks a fully paid loan `COMPLETED`/inactive. UI captures Cash, UPI, Cheque and bank-transfer details plus adjustments, discount and notes.
2. **Single-installment collection endpoint**: locks one installment, validates positive amount against its balance, creates a transaction and updates that installment. It does not update parent loan totals/status. The separate `CollectionDashboard.jsx` uses this endpoint, but `App.jsx` currently routes Today Collection to `CollectionEntryPage.jsx` instead.

History is transaction-based. Compatibility payments and several reports are installment-based. `today_collected` in the collection summary means paid against installments **due today**, rather than all money received today. Customer report `payable_schedule` actually contains received/paid amounts, not an independent creditor-disbursement ledger.

## 8. Authentication and authorization

Normal login calls Django `authenticate`, creates/loads a profile and persistent DRF token, and returns `is_admin`/`can_write`. The frontend stores this response under `finance_session`, sends `Authorization: Token <token>`, and checks `/auth/me/` on session startup. It signs out locally after one hour of inactivity or any intercepted 401/403. Logout clears browser auth state; there is no server-side logout/token-revocation endpoint.

`CanWriteFinanceData` permits authenticated reads; writes require staff, superuser or profile `can_write`. Customer and finance viewsets use it. Account CRUD uses `IsAdminUser`. Function-based finance endpoints generally inherit only global `IsAuthenticated`, including single-installment collection POST and adjustment-type creation; this is an authorization gap.

Temporary development login in `accounts/temporary_auth.py` requires all of: `DEBUG=True`, `TEMP_ADMIN_LOGIN_ENABLED=True`, and nonempty configured username/password. It authenticates without creating a database user/token, returning an unsaved staff/superuser identity with `id: null`. Signed `temp-dev.` tokens expire after eight hours and invalidate on backend restart or credential change; they are intended for a single process. Normal tokens still delegate to DRF. This bypasses the database only for temporary login/current-user authentication; business APIs still need SQL Server. It does not provide Django admin session login.

## 9. PDF and export features

- Chit group detail download uses `utils/chitPdf.js`: A4 jsPDF document, group metadata, sorted installment table, INR amounts, page numbering and a sanitized group-code filename.
- Collection reports call `window.print()` from their PDF button; saving as PDF depends on the browser print dialog.
- `openpyxl` supports **location import**, not report export. No server PDF endpoint, CSV/Excel report export, or collection-receipt PDF generator is implemented.

## 10. Configuration and local setup

### Configuration reference

| Variable | Code default / meaning |
|---|---|
| `SECRET_KEY` | `dev-only-change-me`; Django signing secret |
| `DEBUG` | `True`; parsed by comparison to `true` |
| `ALLOWED_HOSTS` | `127.0.0.1,localhost`; comma-separated |
| `DB_NAME` | `chitfunddd_db` |
| `DB_HOST` | `.\SQLEXPRESS` |
| `DB_PORT` | Empty |
| `ODBC_DRIVER` | `ODBC Driver 17 for SQL Server` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173`; comma-separated |
| `TEMP_ADMIN_LOGIN_ENABLED` | `False` |
| `TEMP_ADMIN_USERNAME`, `TEMP_ADMIN_PASSWORD` | Empty; optional development-only credentials |
| `VITE_API_URL` | Frontend example/fallback: `http://127.0.0.1:8000/api` |

Backend settings load `backend/.env`. SQL Server USER/PASSWORD are deliberately empty; connection options are `Trusted_Connection=yes;TrustServerCertificate=yes;Encrypt=no;`. The Windows account running Django needs database access. Time zone is `Asia/Kolkata` with timezone support enabled. Vite config registers the React plugin and has no API proxy. `.gitignore` excludes environment secrets, virtual environments, dependencies, builds, bytecode and logs.

### Run the backend (PowerShell)

Prerequisites: Python compatible with the pinned requirements (the file records Python 3.13), SQL Server/SQL Express, the configured Microsoft ODBC driver, and an existing database accessible through Windows authentication.

```powershell
cd D:\CHITUFUND\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Create or adjust `backend/.env` with your local values; preserve an existing configuration. A minimal example using the code defaults is:

```dotenv
SECRET_KEY=replace-with-a-local-secret
DEBUG=True
ALLOWED_HOSTS=127.0.0.1,localhost
DB_NAME=chitfunddd_db
DB_HOST=.\SQLEXPRESS
ODBC_DRIVER=ODBC Driver 17 for SQL Server
CORS_ALLOWED_ORIGINS=http://localhost:5173
TEMP_ADMIN_LOGIN_ENABLED=False
```

Then initialize the schema and a real administrator:

```powershell
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 127.0.0.1:8000
```

Use the created credentials at the frontend or `http://127.0.0.1:8000/admin/`. The repository also provides `python manage.py create_default_admin`, which creates **or resets** the development `admin` superuser to the hardcoded password `123`; it is a demo helper, not a production bootstrap. Optional temporary API login can instead be configured with the three `TEMP_ADMIN_*` settings and `DEBUG=True`; restart the backend after changes.

Optional database location import, using an externally supplied workbook:

```powershell
python manage.py import_location_master "C:\path\locations.xlsx"
```

The importer handles country/state/district workbook layouts, including named sheets and country-wise state columns. No workbook is supplied in the project. Importing it does not replace the frontend's bundled location dataset.

### Run the frontend (second terminal)

Prerequisite: Node.js/npm compatible with the resolved Vite version; no Node version is pinned in the repository.

```powershell
cd D:\CHITUFUND\frontend
npm ci
# Only if .env does not already exist:
Copy-Item .env.example .env
npm run dev
```

Open the URL Vite prints, normally `http://localhost:5173`. Set `VITE_API_URL` in `frontend/.env` if the backend differs. If the frontend origin/port changes, add that exact origin to backend CORS settings. Configure supported periods through Loan Type Setup before entering Interest loans. Create chit templates or mortgage products as needed for those loan types.

Build/preview commands are `npm run build` and `npm run preview`. A deployed frontend needs SPA history fallback for direct route access; no deployment configuration is supplied.

## 11. Implemented features and existing checks

Implemented code covers token login and temporary development authentication; customer CRUD/search; master setup; chit template CRUD/activation/PDF; dated mortgage rates and units; all three loan creation/edit paths; persisted installments with payment-preserving edits; holiday CRUD; collection capture/history; pending/outstanding/customer reporting; responsive navigation, themes, drafts and shared form utilities. End-to-end completeness is qualified by the issues below.

Existing checks can be run with:

```powershell
# From backend, with virtual environment active:
python manage.py test accounts finance

# From frontend:
node --test src/utils/loanSchedulePayload.test.js
npm run build
```

Backend tests cover temporary token behavior, preview date/rule validation, customer changes/order, chit totals/dates/activation, interest duration, mortgage quantities/rate history/units, and preserving installment payments on edits. Database-backed finance tests require SQL Server test-database access. Frontend tests cover date conversion and Chit preview payload/date utilities. No browser end-to-end suite or CI workflow is present. These commands were not executed for this documentation-only review.

## 12. Known issues and pending work

These are findings from current code paths, not claims of reproduced runtime failures. Resolve financial consistency and authorization issues before relying on report totals.

| Area | Evidence and maintenance implication |
|---|---|
| Collection accounting | `finance/views.py:collect` allocates across installments but attaches the entire transaction to only the first. `_collection_row` and installment serializer prefer per-installment transaction sums, so paid values can disagree with allocated `paid_amount`. Consolidate the accounting source. |
| Collection adjustments | `collect` ignores submitted `selected_installment_ids` and uses oldest-first allocation. Discount is stored but does not reduce balances; penalty can leave `remaining_unallocated` because allocation considers base installment amounts. Reconcile UI preview with persisted accounting. |
| Alternate payment path | `collections_create` updates only an installment; parent loan totals/status and completion flags can remain stale. Both paths need consistent reconciliation. |
| Authorization | Function-based collection/adjustment POST endpoints lack `CanWriteFinanceData`. `/collections/previous-pending/` points directly to a plain helper that expects DRF `query_params` and returns DRF `Response`, without `@api_view`. |
| Dashboard contract | `DashboardModern` expects `status === "ACTIVE"`, `approved_principal`, `number`, and split due fields such as `principal_due`; current serializers expose different names/shapes. Several cards/chart values therefore do not represent current backend data correctly. |
| Customer details | `App.jsx` renders `CustomerView` without `id`; its validity guard redirects to `/customers`. Editing supplies the ID correctly. |
| Holiday overrides | `HolidayMaster.jsx` calls `/loan-holiday-settings/toggle/`, but no toggle action exists. Its `?loan=` request is not backed by a declared viewset filter. Fallback calendar entries are display-only. |
| Schedule preview parity | Chit preview submits holidays visible in the start month, while persistence considers all active holidays. Interest preview shifts Sundays/holidays but the backend generator ignores those rules; the Interest save payload also omits selected holiday IDs. |
| Interest recurrence | Monthly backend generation mixes `32 * index` day arithmetic for the year with separate month arithmetic; long schedules need calendar-boundary regression coverage. Duration-unit storage does not change installment-count semantics. |
| Report semantics | Day/loan/customer reports and expanded loan balances omit penalties while collection balances include them. History returns `collection_date`/`reference_no`, but UI reads `payment_date` and other reference aliases. History ignores customer-ID, loan-number and customer-type filters sent by the report UI. |
| Report display | History API supplies no summary; other performance panels request summary keys absent from their APIs. Histogram bars in `CollectionReport.jsx` have fixed height. These displays are not complete analytical reporting. |
| Pending UI | Daily Report, Cash Balance and Bank Balance are work-in-progress. Profile save has no backend persistence and the active sidebar omits its update callback. Change Password only displays a message; no self-service endpoint is wired. No account-management page is routed despite admin user CRUD APIs. |
| IDs and concurrent writes | Customer/group code generation reads existing maxima; loan numbers use row count. No dedicated sequence/locking protects generation. Concurrent creation and deletion can produce reuse/conflicts. The loan-wide collect action is atomic but does not lock rows before allocation. |
| Validation/recalculation | Direct subtype/installment CRUD can bypass main workflow invariants. Some Interest/Chit numeric conversions lack guarded error handling. Chit template totals may differ from entered principal. Audit actor fields are not automatically filled. |
| Session behavior | Normal DRF tokens have no configured expiry/revocation flow; inactivity logout is browser-only. A permission-denied 403 signs the user out. Write controls are generally not hidden using `can_write`. |
| Maintenance/scaling | `App.jsx` retains older components and multiple customer-list reassignments; the last assignment is active. Other legacy screens remain alongside routed replacements. Numerous CSS overrides, client-side full-list filtering, first-page limits of 1,000 in several screens, and decorative pagination need consolidation as data grows. |

No automated disbursement ledger, bank reconciliation, payment gateway, SMS/WhatsApp delivery, document upload, background scheduler, backup automation, container setup, or production deployment pipeline is implemented in the inspected source.
