# Operational Runbook

## Overview

This system runs a mixed runtime pipeline: task stages execute first (directory + ATS + Sheets), then registered InfoJobs queries execute. The runner operates sequentially with built-in safety mechanisms:

- **Sequential execution**: Global lock prevents concurrent runs
- **Cycle modes**: `once` runs one full cycle; `forever` loops cycles continuously
- **Pipeline order**: 6 task stages, then active query registry
- **Client pausing (query path)**: Automatic 6-hour pause on rate limit (HTTP 429)
- **Persistent state**: Query status, pauses, and locks persist in SQLite
- **Feedback window**: Sheets feedback only processes 03:00-06:00 Europe/Madrid

## Quick Start

### Initial Setup

```bash
# 1. Copy environment template
cp .env.example .env

# 2. Edit .env and set required credentials
# Required:
#   IJ_CLIENT_ID=your_infojobs_client_id
#   IJ_CLIENT_SECRET=your_infojobs_client_secret
# Optional:
#   DB_PATH=./data/app.db
#   LOG_LEVEL=info
#   RUN_MODE=once

# 3. Build the project
npm run build
```

### Run Once (Single Pass)

```bash
# Default mode: runs one full cycle (tasks, then queries), then exits
node dist/runnerMain.js

# or explicitly
RUN_MODE=once node dist/runnerMain.js
```

Exit codes:

- `0` = cycle completed with no failed task/query
- `1` = one or more task/query failures, or fatal error

Note: If lock acquisition fails (`LOCKED`), the run can complete with no work done (`total=0`) and still exit `0`.

### Run Forever (Continuous)

```bash
# Runs in infinite loop until terminated
RUN_MODE=forever node dist/runnerMain.js
```

Cycle timing: 5-15 minutes between complete passes (randomized).

### One Cycle Lifecycle

`runOnce()` executes this exact sequence:

1. Open DB connection and run migrations.
2. Acquire global run lock (`run_lock.lock_name='global'`).
3. Start lock heartbeat refresh every 15 minutes.
4. Ensure `query_state` rows exist for registered queries.
5. Execute task stages sequentially:
   - `directory:ingest`
   - `ats:discover`
   - `ats:lever:ingest`
   - `ats:greenhouse:ingest`
   - `sheets:sync`
   - `sheets:feedback:apply`
6. Execute registered queries sequentially (currently InfoJobs queries).
7. Stop heartbeat, release lock, close DB.

If lock acquisition fails, the cycle exits early with no stage/query execution.

### Stop Gracefully

```bash
# Send SIGINT (Ctrl+C) or SIGTERM
kill -TERM <pid>
```

The runner will:

1. Log: `"Shutdown signal received, will stop after current cycle"`
2. Complete the current cycle
3. Exit cleanly after cycle finishes

Forced shutdown (second signal) exits immediately.

## How to Tell It's Working

### Key Log Messages

**Startup:**

```
[INFO] Starting runner (single pass mode)
[INFO] Global run lock acquired { ownerId: 'uuid' }
```

**Stage and query execution:**

```
[INFO] Starting directory ingestion
[INFO] ATS discovery batch complete { ... }
[INFO] Executing query { queryKey: 'infojobs:es_generic_all:...', client: 'infojobs', name: 'es_generic_all' }
[INFO] Query executed successfully {
  queryKey: '...',
  status: 'SUCCESS',
  attempts: 1,
  elapsedMs: 45230,
  runId: 123,
  pages_fetched: 5,
  offers_fetched: 100,
  companies_aggregated: 42,
  http_429_count: 0
}
```

**Cycle completion:**

```
[INFO] Runner completed (single pass) { total: ..., success: ..., failed: ..., skipped: ... }
```

`total/success/failed/skipped` include both task stages and queries.

**Forever mode:**

```
[INFO] Runner cycle completed { cycleCount: 1, total: ..., success: ..., failed: ..., skipped: ... }
[INFO] Cycle complete, sleeping before next iteration { cycleCount: 1, sleepMs: 456789 }
```

### Database Location

Default: `./data/app.db` (relative to project root)  
Override: Set `DB_PATH` environment variable

**Healthy state indicators:**

- Database file exists at expected path
- `ingestion_runs` table has recent entries with `status='success'`
- `query_state` table shows `status='SUCCESS'` or `status='IDLE'` for queries
- Task stage start/completion logs are present for recent cycles
- No stale locks in `run_lock` (expires_at > now)

## Observability via SQLite

Open database:

```bash
sqlite3 ./data/app.db
```

Important scope:

- Cycle counters in runner summaries include both task stages and queries.
- `query_state` tracks query path only.
- Task execution state is primarily visible via logs.

### Recent Ingestion Runs

```sql
-- Last 10 runs with key metrics
SELECT
  id,
  provider,
  query_fingerprint,
  status,
  pages_fetched,
  offers_fetched,
  companies_aggregated,
  companies_failed,
  http_429_count,
  started_at,
  finished_at
FROM ingestion_runs
ORDER BY id DESC
LIMIT 10;
```

### Query State (Per-Query Status)

```sql
-- All queries with operational state
SELECT
  query_key,
  client,
  name,
  status,
  last_run_at,
  last_success_at,
  last_error_at,
  consecutive_failures,
  error_code,
  error_message
FROM query_state
ORDER BY client, name;
```

```sql
-- Failing queries only
SELECT
  query_key,
  name,
  consecutive_failures,
  error_code,
  error_message,
  last_error_at
FROM query_state
WHERE status = 'ERROR'
ORDER BY consecutive_failures DESC;
```

### Global Run Lock

```sql
-- Check current lock status
SELECT
  lock_name,
  owner_id,
  acquired_at,
  expires_at,
  datetime('now') as current_time,
  CASE
    WHEN datetime('now') < expires_at THEN 'ACTIVE'
    ELSE 'EXPIRED'
  END as lock_status
FROM run_lock;
```

### Client Pause State

Pause state applies to query execution path (currently InfoJobs queries), not task stages.

```sql
-- Check paused clients
SELECT
  client,
  paused_until,
  reason,
  datetime('now') as current_time,
  CASE
    WHEN datetime('now') < paused_until THEN 'PAUSED'
    ELSE 'EXPIRED'
  END as pause_status,
  updated_at
FROM client_pause;
```

### Companies and Offers

```sql
-- Company count with aggregation signals
SELECT COUNT(*) as total_companies FROM companies;

-- Offers count
SELECT COUNT(*) as total_offers FROM offers;

-- Recent offers
SELECT id, title, company_id, province, created_at
FROM offers
ORDER BY id DESC
LIMIT 10;
```

## Common Situations and Fixes

### Global Lock Held

**Symptoms:**

```
[WARN] Failed to acquire run lock - another run may be in progress { reason: 'LOCKED' }
```

**Confirm:**

```sql
SELECT owner_id, acquired_at, expires_at,
  datetime('now') as now,
  (julianday('now') - julianday(expires_at)) * 86400 as seconds_until_expiry
FROM run_lock
WHERE lock_name = 'global';
```

**Action:**

1. **If lock is active (expires_at > now):**
   - Another process is running → wait for it to finish
   - Check `ps aux | grep runnerMain` to confirm process exists
   - Lock TTL is 3600 seconds (1 hour), and active runner refreshes lock every 900000 ms (15 minutes)
   - While healthy, `expires_at` should keep moving forward

2. **If lock is expired (expires_at < now):**
   - Normal behavior: next run attempt will automatically take over the lock
   - No manual intervention needed

3. **Force clear (ONLY if certain no process is running):**
   ```sql
   DELETE FROM run_lock WHERE lock_name = 'global';
   ```
   ⚠️ **WARNING**: Only do this if you're 100% sure no runner process exists. Check with `ps` first.

**Operational note:**

If lock acquisition fails, that cycle may report `total=0` and do no work. In `forever` mode, next cycles will retry lock acquisition automatically.

### Client Paused Due to Rate Limit

**Symptoms:**

```
[WARN] Client paused due to rate limit { client: 'infojobs', pauseUntil: '2026-02-09T18:30:00.000Z', durationSeconds: 21600 }
[INFO] Query skipped (client paused) { queryKey: '...', client: 'infojobs', ... }
```

**Confirm:**

```sql
SELECT client, paused_until, reason,
  (julianday(paused_until) - julianday('now')) * 86400 as seconds_remaining
FROM client_pause;
```

**Action:**

This is **expected behavior** after hitting InfoJobs rate limits (HTTP 429).

- Pause duration: **6 hours** (21600 seconds)
- Runner will automatically skip queries for that client until pause expires
- No intervention needed - wait for pause to expire naturally
- In `forever` mode, runner will check again on next cycle
- Task stages are unaffected by this pause state

**Early resume (use with caution):**

```sql
-- Only if you're certain the rate limit has lifted
DELETE FROM client_pause WHERE client = 'infojobs';
```

### Queries Failing Repeatedly

**Symptoms:**

```
[ERROR] Query failed after all retries {
  queryKey: '...',
  status: 'ERROR',
  attempts: 3,
  error_code: 'TRANSIENT',
  error_message: '...'
}
```

**Confirm:**

```sql
SELECT query_key, name, consecutive_failures, error_code, error_message, last_error_at
FROM query_state
WHERE consecutive_failures > 0
ORDER BY consecutive_failures DESC;
```

**Action by error_code:**

- **`RATE_LIMIT`**: Client is/was paused. Check `client_pause` table (see above).
- **`AUTH`**: Invalid InfoJobs credentials. Check `IJ_CLIENT_ID` and `IJ_CLIENT_SECRET` in `.env`.
- **`TRANSIENT`**: Temporary network/API issue. May resolve on next run.
- **`HTTP_5XX`**: InfoJobs server error. Wait and retry.
- **`FATAL`**: Config or auth issue that won't resolve with retries. Fix root cause.

**Reset query state to retry:**

```sql
-- Reset single query
UPDATE query_state
SET status = 'IDLE',
    consecutive_failures = 0,
    error_code = NULL,
    error_message = NULL,
    updated_at = datetime('now')
WHERE query_key = 'infojobs:es_generic_all:...';

-- Reset all failed queries (keeps history)
UPDATE query_state
SET status = 'IDLE',
    consecutive_failures = 0,
    error_code = NULL,
    error_message = NULL,
    updated_at = datetime('now')
WHERE status = 'ERROR';
```

### Stage Troubleshooting (Task Pipeline)

#### Directory Sources Ingestion (`directory:ingest`)

**Symptoms:** low `upserted`, high `failed`, or no recent `"Directory ingestion complete"` log.

**Action:**

- Check task logs for `fetched/attempted/upserted/skipped/failed` counters.
- Validate outbound HTTP/network access to source directories.
- Re-run one cycle and compare counters before/after.

#### ATS Discovery Batch (`ats:discover`)

**Symptoms:** `checked` increases but `found/persisted` stay near zero.

**Action:**

- Inspect `"ATS discovery batch complete"` counters (`checked/found/persisted/notFound/error`).
- Verify companies have reachable website URLs in DB.
- Expect partial misses; prioritize rising `error` counts.

#### Lever ATS Ingestion (`ats:lever:ingest`)

**Symptoms:** `"Lever ingestion pipeline complete"` with persistent `failed > 0` or `upserted=0` despite known sources.

**Action:**

- Check completion counters (`processed/upserted/skipped/failed/affectedCompanies`).
- Verify `company_sources` rows exist for provider `lever`.
- Investigate network/API availability for affected tenants.

#### Greenhouse ATS Ingestion (`ats:greenhouse:ingest`)

**Symptoms:** `"Greenhouse ingestion pipeline complete"` with persistent `failed > 0` or `upserted=0` despite known sources.

**Action:**

- Check completion counters (`processed/upserted/skipped/failed/affectedCompanies`).
- Verify `company_sources` rows exist for provider `greenhouse`.
- Investigate network/API availability for affected boards.

#### Sheets Sync (`sheets:sync`) — Config-Gated

**Symptoms:** `"Sheets sync skipped: not configured"` or task failure due to auth/config.

**Action:**

- If Sheets is not needed, leave `GOOGLE_SHEETS_SPREADSHEET_ID` unset.
- If needed, set `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
- Confirm service account has spreadsheet access.

#### Feedback Apply (`sheets:feedback:apply`) — Config + Time-Gated

**Symptoms:** `"Feedback apply skipped: Sheets not configured"` or `"Feedback apply skipped: outside nightly window"`.

**Action:**

- Confirm gate: feedback runs only during `03:00-06:00` `Europe/Madrid`.
- Run during window if feedback application is required.
- Keep Sheets disabled by unsetting `GOOGLE_SHEETS_SPREADSHEET_ID` when not needed.

### Feedback Skipped Outside Nightly Window

**Symptoms:**

```
[INFO] Feedback apply skipped: outside nightly window { reason: 'Outside feedback window (3:00-6:00 Europe/Madrid), current hour: ...' }
```

**Confirm:**

This is **expected behavior**, not an error.

Feedback processing only runs **03:00-06:00 Europe/Madrid** by design to avoid daytime race conditions.

**Action:**

None needed. This is a safety feature. If you need feedback processing:

- Run during the allowed window (03:00-06:00 Madrid time)
- Or disable Sheets integration by unsetting `GOOGLE_SHEETS_SPREADSHEET_ID`

### Google Sheets Auth/Config Errors

**Symptoms:**

```
[ERROR] Failed to initialize Sheets client { error: 'Invalid service account credentials' }
[ERROR] Task execution failed { taskKey: 'sheets:sync', ... }
```

**Action:**

Sheets integration is **optional**. Only enabled when `GOOGLE_SHEETS_SPREADSHEET_ID` is set.

**If you don't need Sheets:**

```bash
# In .env, comment out or remove:
# GOOGLE_SHEETS_SPREADSHEET_ID=
```

**If you need Sheets, verify credentials:**

```bash
# Check .env has all required vars:
GOOGLE_SHEETS_SPREADSHEET_ID=1A2B3C...
GOOGLE_SERVICE_ACCOUNT_EMAIL=sa@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Common issues:

- Private key format: Must have literal `\n` sequences, not actual newlines
- Service account permissions: Must have access to the target spreadsheet
- Required scope: `https://www.googleapis.com/auth/spreadsheets`

### InfoJobs Auth/Config Errors

**Symptoms:**

```
[ERROR] Query failed with FATAL error { error_code: 'AUTH', error_message: 'Unauthorized' }
```

**Action:**

InfoJobs credentials are **required** for runner execution.

1. Verify `.env` has valid credentials:

   ```bash
   IJ_CLIENT_ID=your_actual_client_id
   IJ_CLIENT_SECRET=your_actual_client_secret
   ```

2. Test credentials work (get new ones from [InfoJobs Developer Portal](https://developer.infojobs.net/) if needed)

3. After fixing `.env`, restart the runner (rebuild not needed)

### Database File Missing/Corrupt

**Symptoms:**

```
Error: SQLITE_CANTOPEN: unable to open database file
Error: SQLITE_CORRUPT: database disk image is malformed
```

**Action:**

**If database is missing:**

```bash
# Create and migrate from scratch
npm run db:migrate
```

**If database is corrupt:**

⚠️ **WARNING**: This loses all ingestion history, offers, and companies.

```bash
# Backup existing (even if corrupt)
cp ./data/app.db ./data/app.db.corrupt.backup

# Start fresh
rm ./data/app.db
npm run db:migrate
```

Recovery from backup is not automatic. If you need the data, manual SQLite recovery may be possible but is beyond scope of this runbook.

## Safe Resets

### Clear Client Pause

```sql
-- Remove pause for specific client
DELETE FROM client_pause WHERE client = 'infojobs';

-- Remove all pauses
DELETE FROM client_pause;
```

Safe: No data loss. Client will resume immediately on next run.

### Reset Single Query State

```sql
-- Reset to IDLE, clear errors, keep history
UPDATE query_state
SET status = 'IDLE',
    consecutive_failures = 0,
    error_code = NULL,
    error_message = NULL,
    updated_at = datetime('now')
WHERE query_key = 'infojobs:es_generic_all:...';
```

Safe: Keeps `last_run_at`, `last_success_at` timestamps intact.

### Reset All Failed Queries

```sql
-- Clear all errors without deleting rows
UPDATE query_state
SET status = 'IDLE',
    consecutive_failures = 0,
    error_code = NULL,
    error_message = NULL
WHERE status = 'ERROR';
```

Safe: Preserves execution history.

### Clear Run Lock (Emergency Only)

```sql
DELETE FROM run_lock WHERE lock_name = 'global';
```

⚠️ **WARNING**: Only do this if:

1. You're certain no runner process is active (`ps aux | grep runnerMain`)
2. Lock is preventing startup despite being expired
3. You understand this could cause concurrent execution if you're wrong

### Dangerous Operations (Explicit Warnings)

**Delete ingestion_runs:**

```sql
-- ⚠️ DANGER: Loses audit trail of all runs
-- Only do this if you accept losing historical tracking
DELETE FROM ingestion_runs;
```

**Delete offers:**

```sql
-- ⚠️ DANGER: Loses all scraped offers
-- This is a full data reset
DELETE FROM offers;
```

**Delete companies:**

```sql
-- ⚠️ DANGER: Loses all companies and aggregation signals
-- This requires re-ingestion and re-aggregation
DELETE FROM companies;
```

**Full reset (nuclear option):**

```bash
# ⚠️ DANGER: Complete data loss
rm ./data/app.db
npm run db:migrate
```

## Operational Recommendations

### Production Deployment

**Run as systemd service (Linux):**

```ini
# /etc/systemd/system/buiss-scraper.service
[Unit]
Description=BuISS Job Scraper
After=network.target

[Service]
Type=simple
User=scraper
WorkingDirectory=/opt/buiss-scraper
Environment="RUN_MODE=forever"
Environment="LOG_LEVEL=info"
ExecStart=/usr/bin/node dist/runnerMain.js
Restart=on-failure
RestartSec=60
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Place `.env` in `/opt/buiss-scraper/.env` with proper permissions (`chmod 600`).

```bash
sudo systemctl enable buiss-scraper
sudo systemctl start buiss-scraper
sudo journalctl -u buiss-scraper -f
```

### Log Level

**Recommended: `info`** (default)

- Logs task stages and query executions (successes/failures/skips)
- Cycle summaries with metrics
- Errors with full context

**Use `debug` for troubleshooting:**

- Adds query state transitions
- Lock acquisition details
- Client pause checks

**Use `warn` or `error` for production quietness:**

- Only logs warnings and errors
- Useful if you have external monitoring

### SQLite Backup

```bash
# Daily backup (run as cron job)
sqlite3 ./data/app.db ".backup ./data/backups/app-$(date +%Y%m%d).db"

# Keep last 7 days
find ./data/backups -name "app-*.db" -mtime +7 -delete
```

Or use filesystem-level snapshots if available.

### Monitoring Checklist

✓ Runner process is running (`ps aux | grep runnerMain`)  
✓ Recent entries in `ingestion_runs` with `status='success'`  
✓ No queries with `consecutive_failures > 3`  
✓ No stale run lock (expires_at < now for > 1 hour)  
✓ Disk space available for database growth  
✓ Logs don't show repeated FATAL errors

### Scaling Considerations

- SQLite is single-writer: Only one runner should execute at a time (enforced by global lock)
- For horizontal scaling, consider migrating to PostgreSQL and distributed locking
- Current design: vertical scaling only (more powerful single machine)
