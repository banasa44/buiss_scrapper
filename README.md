# buiss-scrapper

InfoJobs offer scraper with scoring and aggregation pipeline.

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Installation

```bash
npm install
```

## Quickstart

```bash
cp .env.example .env
# fill required values (InfoJobs credentials)
npm run db:migrate
npm run dev
```

### Development

Run the application in development mode with hot-reload support:

```bash
npm run dev
```

### Build

Compile TypeScript to JavaScript:

```bash
npm run build
```

### Production

Run the compiled application:

```bash
npm start
```

## Configuration

Copy `.env.example` to `.env`. `npm run dev` and `npm start` load `.env`
automatically via `dotenv/config` in `src/main.ts`. Other scripts read from the
shell environment directly (for example: `DB_PATH=./data/app.db npm run db:migrate`).

**InfoJobs (required for app run)**

- `IJ_CLIENT_ID` - InfoJobs API client ID. Required for `npm run dev` and `npm start` unless credentials are injected in code.
- `IJ_CLIENT_SECRET` - InfoJobs API client secret. Required for `npm run dev` and `npm start` unless credentials are injected in code.

**Database (optional)**

- `DB_PATH` - SQLite database file path. Defaults to `./data/app.db` if unset.

**Logging (optional)**

- `LOG_LEVEL` - One of `debug`, `info`, `warn`, `error`. Defaults to `info`.

**Google Sheets integration (optional)**
Set `GOOGLE_SHEETS_SPREADSHEET_ID` to enable Sheets sync + feedback during ingestion. When enabled, missing/invalid credentials are fatal at init.
The integration uses a service account with scope `https://www.googleapis.com/auth/spreadsheets`. Ensure the service account has access to the target spreadsheet.

Private key format: The `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` value is automatically normalized to handle common `.env` formatting issues (quoted strings, `\n` escapes). Use the standard format with literal `\n` sequences:

```
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgk...\n-----END PRIVATE KEY-----\n"
```

- `GOOGLE_SHEETS_SPREADSHEET_ID` - Target spreadsheet ID that enables Sheets integration.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account email (required when Sheets integration is enabled).
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` - Service account private key PEM (required when Sheets integration is enabled).
- `GOOGLE_PROJECT_ID` - Optional. Stored for completeness; not required for auth.

**Runtime toggles (documented but not wired yet)**

- `STORE_RAW_JSON` - Documented in `docs/M1/01_define_db_schema.md`; currently unused in code.
- `HTTP_MOCK_MODE` - Documented in `docs/audits/AUDIT_HTTP_MOCKING_HARNESS.md`; currently unused in code.

## Project Structure

- `src/` - Source code
  - `clients/` - External API clients (InfoJobs, etc.)
  - `types/` - Shared TypeScript types
  - `config/` - Configuration loader (future)
  - `db/` - Database layer (future)
  - `core/` - Business logic (future)
  - `exporters/` - Export modules (future)

## Import Aliases

The project uses `@/` as an alias for `src/` to enable clean imports:

```typescript
import { InfoJobsClient } from "@/clients/infojobs";
```
