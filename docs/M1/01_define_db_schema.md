# [DEFINE] Minimal DB Schema — SQLite

## 1. Tables (DDL)

### `companies`

```sql
CREATE TABLE companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_company_id TEXT,
  name TEXT,
  normalized_name TEXT,
  hidden INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_company_provider_id UNIQUE (provider, provider_company_id),
  CONSTRAINT uq_company_normalized UNIQUE (provider, normalized_name)
);
```

### `offers`

```sql
CREATE TABLE offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_offer_id TEXT NOT NULL,
  provider_url TEXT,
  company_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  min_requirements TEXT,
  desired_requirements TEXT,
  requirements_snippet TEXT,
  published_at TEXT,
  updated_at TEXT,
  created_at TEXT,
  applications_count INTEGER,
  metadata_json TEXT,
  raw_json TEXT,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT uq_offer_provider_id UNIQUE (provider, provider_offer_id)
);
```

### `matches` (1:1 with offer)

```sql
CREATE TABLE matches (
  offer_id INTEGER PRIMARY KEY,
  score REAL NOT NULL DEFAULT 0.0,
  matched_keywords_json TEXT NOT NULL,
  reasons TEXT,
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);
```

### `ingestion_runs`

```sql
CREATE TABLE ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  query_fingerprint TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT,
  pages_fetched INTEGER,
  offers_fetched INTEGER,
  requests_count INTEGER,
  http_429_count INTEGER,
  errors_count INTEGER,
  notes TEXT
);
```

---

## 2. Constraints (Idempotency)

**Offers:**

- `UNIQUE (provider, provider_offer_id)` — prevents duplicate offers

**Companies:**

- `UNIQUE (provider, provider_company_id)` — dedupe by provider ID when available
- `UNIQUE (provider, normalized_name)` — fallback dedupe by normalized name
- Ingestion logic: prefer `provider_company_id`; if null, use `normalized_name`

**Matches:**

- `PRIMARY KEY (offer_id)` — enforces 1:1 relationship with offers (overwrite on recompute)

**Foreign Keys:**

- `offers.company_id → companies.id`
- `matches.offer_id → offers.id`

---

## 3. Indexes (Essential Only)

```sql
CREATE INDEX idx_offers_company ON offers(company_id);
CREATE INDEX idx_offers_updated ON offers(updated_at);
```

Rationale: `company_id` for aggregation queries; `updated_at` for incremental fetching.

---

## 4. Raw JSON Policy (Space Safety)

- `offers.raw_json` is nullable and overwritten on upsert (no history).
- Default: do NOT store raw JSON (keeps DB size bounded).
- Optional: set `STORE_RAW_JSON=1` environment variable to enable storage (useful for debugging/re-mapping).
- Implementation: DB layer checks env flag before populating this column.

---

## 5. Notes

**Why keep `provider_company_id`?**

- Internal dedupe stability: if InfoJobs changes a company's display name, we still recognize it by ID.
- Even if `name` is the primary human identifier, `provider_company_id` ensures rerun safety.

**Why no `offer_ingestions` join table?**

- No immediate need: we don't track "which runs saw which offers" per-offer.
- `ingestion_runs` table provides run-level audit (pages/offers fetched, errors).
- If later we need per-offer run tracking, add `offer_ingestions(run_id, offer_id, action)`.

**Why `matches` is 1:1 and overwrites?**

- Matching logic recomputes scores when catalog changes.
- Overwriting simplifies consistency: latest match is always current.
- If historical match scores are needed later, add versioning/timestamps.

**Why restore `description`, `min_requirements`, etc. in `offers`?**

- Needed for text matching/scoring and explainability without re-fetching from API.
- Avoids future schema changes when scoring logic needs these fields.

**Why add `requests_count` and `http_429_count` to `ingestion_runs`?**

- Basic rate-limit observability: track total requests and 429 responses per run.
- Avoids needing a separate per-request logging table for MVP.

---

## Summary

**Tables:** `companies`, `offers`, `matches`, `ingestion_runs`  
**Guarantees:** Idempotent reruns via unique constraints; 1:1 match per offer; run-level audit trail  
**Key Trade-offs:** No location modeling, no offer history tracking, optional raw JSON storage  
**Next:** Implement migrations + repository layer with upsert logic (`INSERT ... ON CONFLICT`)
