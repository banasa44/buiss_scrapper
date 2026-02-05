# Google Sheets Auth Contract (M5/M6)

**Scope**
This contract documents the authentication and configuration expectations for the Google Sheets integration used by M5 (export) and M6 (feedback). It reflects the current implementation and fail-fast behavior.

**Supported Auth Method**

- Service account JWT flow (OAuth2 token exchange) using `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
- Credentials may be supplied via `GoogleSheetsClient` config, otherwise env vars are used.
- No OAuth user consent, ADC, or API key support.

**Required Config When Sheets Integration Is Enabled**

- `GOOGLE_SHEETS_SPREADSHEET_ID` (env): target spreadsheet ID. If unset, Sheets integration is skipped.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` (env) or `GoogleSheetsClient` config `credentials.clientEmail`.
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (env) or `GoogleSheetsClient` config `credentials.privateKey`.

**Private Key Format (.env)**
The private key normalization is robust to typical `.env` formatting:

- Accepts keys wrapped in quotes: `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."`
- Automatically converts literal `\n` sequences to actual newlines
- Strips extra whitespace and normalizes line endings
- Validates PEM markers (`BEGIN PRIVATE KEY` and `END PRIVATE KEY`) at init to catch misconfigurations early

Example `.env` entry:

```
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhki...\n-----END PRIVATE KEY-----\n"
```

**Optional Config**

- `GOOGLE_PROJECT_ID` (env): not required for auth, stored for completeness.

**Fixed Sheet Contract (Not Configurable Today)**

- Sheet tab name: `Companies`.
- Read range: `Companies!A:Z`.
- Metric update ranges are derived from fixed column indices in `src/constants/sheets.ts`.

**Failure Modes**
Fatal at init/auth/config (throws, fails the run):

- `GoogleSheetsClient` constructed without `spreadsheetId`.
- Missing or empty credentials (env or config).
- OAuth2 token fetch fails during `assertAuthReady()`.

Best-effort at runtime (warn + skip; ingestion continues):

- Sheets API read/append/update failures during sync or feedback processing.
- Per-row parsing or mapping failures (invalid IDs/resolution, unmappable rows).
- Feedback window blocked (03:00-06:00 Europe/Madrid) returns `skipped` without error.

**Decision Note (Why Service Account Only)**
Service accounts fit headless, scheduled ingestion without user consent flows, reduce operational complexity, and keep credentials scoped to a single spreadsheet. Supporting multiple auth methods would add surface area without current benefit, so we standardize on a single method to keep ops risk low.

**Gap List (Current Risks + Minimal Changes)**

- Spreadsheet existence and tab name are not validated at init; invalid IDs surface only during API calls. Minimal proposal: optional preflight read of header range, but would make transient network issues fatal, so it is not enabled today.
- OAuth2 token request has no explicit timeout or retry; a hung token request can block init. Minimal proposal: add timeout and retry with backoff for token fetch.
- Credentials passed via config were previously unchecked; now validated and normalized (`\\n` to newlines).
- Auth/config failures were previously swallowed as non-fatal; now fail-fast via `assertAuthReady()` before any Sheets calls.
