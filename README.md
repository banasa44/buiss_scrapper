# buiss-scrapper

InfoJobs offer scraper with scoring and aggregation pipeline.

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

**Single pass (run all queries once, then exit):**
```bash
npm run build && node dist/runnerMain.js
# or explicitly:
RUN_MODE=once node dist/runnerMain.js
```

**Continuous mode (run forever until terminated):**
```bash
RUN_MODE=forever node dist/runnerMain.js
```

### Verify It's Working

**Check logs:**
- Look for `"Starting runner"` and `"Query executed successfully"` messages
- Each query logs: `queryKey`, `status`, `elapsedMs`, `runId`, `pages_fetched`, `offers_fetched`

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
[INFO] Executing query { queryKey: 'infojobs:es_generic_all:...', ... }
[INFO] Query executed successfully { status: 'SUCCESS', pages_fetched: 5, offers_fetched: 100, ... }
[INFO] Runner completed (single pass) { total: 3, success: 3, failed: 0, skipped: 0 }
```

## Development

Run the application in development mode with hot-reload support:

```bash
npm run dev
```

This runs `src/main.ts` (legacy entry point). For M7 orchestration, use `runnerMain.js` as shown above.

## Configuration

All configuration is done via environment variables. Copy `.env.example` to `.env` and customize.

**Required:**
- `IJ_CLIENT_ID` - InfoJobs API client ID
- `IJ_CLIENT_SECRET` - InfoJobs API client secret

**Optional:**
- `DB_PATH` - SQLite database path (default: `./data/app.db`)
- `LOG_LEVEL` - Logging verbosity: `debug`, `info`, `warn`, `error` (default: `info`)
- `RUN_MODE` - Execution mode: `once` or `forever` (default: `once`)

**Google Sheets Integration (optional):**

Set `GOOGLE_SHEETS_SPREADSHEET_ID` to enable automated Sheets sync and feedback processing.
When enabled, you must also provide:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account email
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` - Service account private key (PEM format with `\n` escapes)
- `GOOGLE_PROJECT_ID` - GCP project ID (optional)

The service account needs `https://www.googleapis.com/auth/spreadsheets` scope and access to the target spreadsheet.

**Loading:**
- `npm run dev` and `npm start` (via `src/main.ts`) load `.env` automatically using `dotenv/config`
- `runnerMain.js` also loads `.env` automatically
- Other scripts (`db:migrate`, etc.) read from shell environment directly

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
