# buiss-scrapper

Job offer ingestion pipeline with scoring, aggregation, and optional Sheets sync.

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- InfoJobs API credentials ([get them here](https://developer.infojobs.net/))

### Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set your InfoJobs credentials:

   ```bash
   IJ_CLIENT_ID=your_actual_client_id
   IJ_CLIENT_SECRET=your_actual_client_secret
   ```

3. **Initialize database**

   ```bash
   npm run db:migrate
   ```

   This creates `./data/app.db` and runs all migrations.

4. **Build the project**
   ```bash
   npm run build
   ```

### Running the Scraper

Canonical runtime entrypoint: `dist/runnerMain.js`.

`RUN_MODE=once` (default) runs one full cycle and exits.
One cycle executes:

1. Directory Sources Ingestion (`directory:ingest`)
2. ATS Discovery Batch (`ats:discover`)
3. Lever ATS Ingestion (`ats:lever:ingest`)
4. Greenhouse ATS Ingestion (`ats:greenhouse:ingest`)
5. Sheets Sync (`sheets:sync`)
6. Feedback Apply (`sheets:feedback:apply`)
7. Registered InfoJobs queries (transitional mixed runtime; queries still run after tasks)

```bash
npm run build && node dist/runnerMain.js
# or explicitly:
RUN_MODE=once node dist/runnerMain.js
```

`RUN_MODE=forever` runs cycles continuously until terminated:

```bash
RUN_MODE=forever node dist/runnerMain.js
```

### Verify It's Working

**Check logs:**

- Look for `"Starting runner"` and `"Runner completed (single pass)"` messages
- Tasks log stage start/completion (directory, ATS discovery, lever, greenhouse, sheets sync, feedback apply)
- Queries log `Executing query` and `Query executed successfully` with `queryKey`, `status`, `elapsedMs`, and run counters

**Inspect database:**

```bash
sqlite3 ./data/app.db
```

```sql
-- Check ingestion runs
SELECT id, provider, status, pages_fetched, offers_fetched, started_at FROM ingestion_runs ORDER BY id DESC LIMIT 5;

-- Check scraped offers
SELECT COUNT(*) as total_offers FROM offers;

-- Check query state (M7 orchestration)
SELECT query_key, status, last_success_at, consecutive_failures FROM query_state;
```

**Common first-run output:**

```
[INFO] Starting runner (single pass mode)
[INFO] Global run lock acquired
[INFO] Starting directory ingestion
[INFO] Greenhouse ingestion pipeline complete
[INFO] Executing query { queryKey: 'infojobs:es_generic_all:...', ... }
[INFO] Query executed successfully { status: 'SUCCESS', pages_fetched: 5, offers_fetched: 100, ... }
[INFO] Runner completed (single pass) { total: ..., success: ..., failed: ..., skipped: ... }
```

## Development

Run the application in development mode with hot-reload support:

```bash
npm run dev
```

`npm run dev` runs `src/main.ts`, which is a legacy non-pipeline entrypoint.
Current pipeline runtime is `runnerMain` (`node dist/runnerMain.js`).
`npm start` also points to legacy `dist/main.js`.

## Configuration

All configuration is done via environment variables. Copy `.env.example` to `.env` and customize.

**Required in practice (current runner cycle):**

- `IJ_CLIENT_ID` - InfoJobs API client ID
- `IJ_CLIENT_SECRET` - InfoJobs API client secret

InfoJobs queries are still active after the task pipeline, so these are currently required for successful full cycles.

**Optional defaults:**

- `DB_PATH` - SQLite database path (default: `./data/app.db`)
- `LOG_LEVEL` - Logging verbosity: `debug`, `info`, `warn`, `error` (default: `info`)
- `RUN_MODE` - Execution mode: `once` or `forever` (default: `once`)

**Conditional: Google Sheets integration**

Set `GOOGLE_SHEETS_SPREADSHEET_ID` to enable automated Sheets sync and feedback processing.
When enabled, you must also provide:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account email
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` - Service account private key (PEM format with `\n` escapes)
- `GOOGLE_PROJECT_ID` - GCP project ID (optional)

The service account needs `https://www.googleapis.com/auth/spreadsheets` scope and access to the target spreadsheet.

**Test-only:**

- `LIVE_SHEETS_TEST` - Enables live Sheets connectivity tests; not used by `runnerMain` runtime

**Loading:**

- `npm run dev` and `npm start` (via `src/main.ts`) load `.env` automatically using `dotenv/config`
- `runnerMain.js` also loads `.env` automatically
- Other scripts (`db:migrate`, etc.) read from shell environment directly

## Project Structure

- `src/` - Source code
  - `tasks/` - Task pipeline registry and task implementations
  - `orchestration/` - Runner orchestration (`runOnce`, `runForever`)
  - `atsDiscovery/` - ATS detection pipeline
  - `companySources/` - Directory source ingestion
  - `ingestion/` - Offer ingestion and run lifecycle
  - `sheets/` - Sheets sync and feedback processing
  - `queries/` - Registered query definitions (currently InfoJobs)
  - `db/` - Database connection, migrations, repositories
  - `clients/` - External API clients (InfoJobs, Lever, Greenhouse, Google Sheets)
  - `constants/` - Shared runtime/config constants
  - `types/` - Shared TypeScript types

## Import Aliases

The project uses `@/` as an alias for `src/` to enable clean imports:

```typescript
import { InfoJobsClient } from "@/clients/infojobs";
```
