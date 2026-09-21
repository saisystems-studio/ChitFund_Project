# CHITUFUND

A web application for managing customers, chit groups, loans, installment schedules, and payment collections. The frontend uses React and Vite; the REST API uses Django and Microsoft SQL Server.

## Features

- Customer records and country, state, and district masters.
- Chit group configuration, loan types, and installment settings.
- Loan applications, schedule previews, and active loan management.
- Collection entry, pending amounts, outstanding collections, and collection history.
- Holiday configuration and dashboard summaries.
- User accounts with administrator and write-access permissions.
- Light and dark themes and responsive navigation.

The Daily Report, Cash Balance, and Bank Balance frontend pages currently display work-in-progress screens.

## Technology

| Layer | Technologies |
| --- | --- |
| Frontend | React, Vite, Axios |
| Backend | Django 5.2, Django REST Framework |
| Database | Microsoft SQL Server, mssql-django, pyodbc |
| Authentication | DRF tokens; optional temporary development login |
| Excel import | openpyxl |

## Prerequisites

- Windows with access to Microsoft SQL Server through Windows Authentication.
- Python 3.13 (the version recorded as validated in `backend/requirements.txt`).
- Node.js matching the lockfile requirements: `^20.19.0` or `>=22.12.0`, with npm.
- ODBC Driver 17 for SQL Server, or another installed driver configured through `ODBC_DRIVER`.
- An existing SQL Server database and a Windows account with permission to create and update its tables.

The backend currently uses SQL Server only. Database username and password authentication is not configured.

## Local setup

Run the following commands in PowerShell, starting from the repository root.

### 1. Install backend dependencies

```powershell
cd backend
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

These commands use the virtual environment directly, so activation is optional.

### 2. Configure the backend

Create `backend/.env`, or update your existing file, using these local development settings:

```dotenv
SECRET_KEY=replace-with-a-unique-random-secret
DEBUG=True
ALLOWED_HOSTS=127.0.0.1,localhost

DB_NAME=chitfunddd_db
DB_HOST=127.0.0.1
DB_PORT=1433
ODBC_DRIVER=ODBC Driver 17 for SQL Server

CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
TEMP_ADMIN_LOGIN_ENABLED=False
```

Set the database values to match your SQL Server instance. Create the database before running migrations. Connections use the Windows identity running Django. Restart the backend after changing environment variables.

Environment files are ignored by Git; keep credentials and real environment values out of source control.

### 3. Initialize and start the backend

From `backend/`:

```powershell
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py createsuperuser
.\.venv\Scripts\python.exe manage.py runserver
```

Use the superuser credentials to sign in to the application or Django admin.

- API base URL: `http://127.0.0.1:8000/api/`
- Django admin: `http://127.0.0.1:8000/admin/`

### 4. Start the frontend

Open a second PowerShell terminal at the repository root:

```powershell
cd frontend
npm ci
```

If `frontend/.env` does not exist, copy the provided example:

```powershell
Copy-Item .env.example .env
```

Its API setting is:

```dotenv
VITE_API_URL=http://127.0.0.1:8000/api
```

Start Vite:

```powershell
npm run dev
```

Open `http://localhost:5173` and sign in. If Vite selects a different port, add that origin to `CORS_ALLOWED_ORIGINS` and restart Django. Restart Vite after changing its environment file.

## Development commands

Run backend commands from `backend/`:

```powershell
# Check Django configuration
.\.venv\Scripts\python.exe manage.py check

# Run the existing authentication tests
.\.venv\Scripts\python.exe manage.py test accounts.test_temporary_auth

# Import location masters from an Excel workbook
.\.venv\Scripts\python.exe manage.py import_location_master "C:\path\to\locations.xlsx"
```

Run frontend commands from `frontend/`:

```powershell
# Build the frontend into dist/
npm run build

# Preview the built frontend locally
npm run preview
```

The frontend has no test or lint script configured. When using preview, add the preview origin shown by Vite to the backend's allowed CORS origins if needed.

## Optional development login

For a temporary administrator login, set these values in `backend/.env` and restart Django:

```dotenv
DEBUG=True
TEMP_ADMIN_LOGIN_ENABLED=True
TEMP_ADMIN_USERNAME=local-admin
TEMP_ADMIN_PASSWORD=replace-with-a-local-development-password
```

This login does not persist a user or token. Its tokens expire after eight hours or a backend restart. It requires debug mode and both credentials to be configured. Database-backed features still require a working SQL Server connection.

The repository also includes `manage.py create_default_admin`. It creates or updates `admin` and resets its password to the fixed demo value `123`; use it only for disposable local data. The setup above uses `createsuperuser` so you can choose your own credentials.

## API overview

Most endpoints require an `Authorization: Token <token>` header. Obtain a token by posting JSON containing `username` and `password` to `/api/auth/login/`.

| Path | Purpose |
| --- | --- |
| `/api/auth/login/` | Sign in |
| `/api/auth/me/` | Current user |
| `/api/auth/users/` | User administration |
| `/api/customers/` | Customer records |
| `/api/dashboard/` | Dashboard data |
| `/api/districts/`, `/api/locations/` | Location lookup |
| `/api/finance/loan-types/` | Loan type configuration |
| `/api/finance/chit-groups/` | Chit groups |
| `/api/finance/loans/` | Customer loans |
| `/api/finance/chit-loans/preview-schedule/` | Schedule preview |
| `/api/finance/collections/` | Collections |
| `/api/finance/collections/summary/` | Collection summaries |
| `/api/finance/collection-history/` | Collection history |
| `/api/finance/holidays/` | Holiday master |
| `/api/finance/reports/day-wise/` | Day-wise report data |
| `/api/finance/reports/loan-wise/` | Loan-wise report data |

See the URL definitions in each backend application for the complete endpoint list.

## Project structure

```text
CHITUFUND/
|-- backend/
|   |-- accounts/       # Login, permissions, and user management
|   |-- config/         # Django settings and root URLs
|   |-- customers/      # Customers and location masters
|   |-- finance/        # Loans, chit groups, collections, and reports
|   |-- manage.py
|   `-- requirements.txt
|-- frontend/
|   |-- src/
|   |   |-- components/
|   |   |-- pages/
|   |   |-- styles/
|   |   `-- App.jsx
|   |-- .env.example
|   `-- package.json
`-- README.md
```

## Troubleshooting

- **SQL Server connection fails:** Check that the database exists, SQL Server accepts connections on the configured host and port, and your Windows account has database access.
- **ODBC driver is missing:** Install the driver or set `ODBC_DRIVER` to the exact name of an installed SQL Server driver.
- **Browser blocks API requests:** Match the frontend origin, including its port, in `CORS_ALLOWED_ORIGINS` and confirm `VITE_API_URL` points to the running backend.
- **Tables are missing:** Run `manage.py migrate` against the configured database.
- **Temporary login stops working after restart:** Sign in again to obtain a new token.

The commands in this README are for local development. The current database connection options disable encryption and trust the server certificate; deployment requires reviewing these settings along with secrets, debug mode, allowed hosts, and CORS origins.
