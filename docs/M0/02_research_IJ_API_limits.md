## 2) [RESEARCH] Assess InfoJobs API limits

**Objective:** Understand practical limits so the connector is built correctly from day one.

**Key considerations:**

- Pagination model: page/offset vs cursor, max page size, max reachable pages.
- Rate limits / throttling behavior (429 patterns, retry-after, etc.).
- Whether the API supports “delta” queries (since/updatedAfter) or if we must filter client-side.
- Any constraints that affect run cadence (daily vs twice daily) and per-query caps.

**Desired output:**

- A concise note listing:
  - pagination strategy we will implement
  - safe defaults for per-query caps and backoff
  - whether delta support exists and how we’ll use it (or fallback approach)


## RESOLUTION

# InfoJobs API — Limits & Execution Strategy (Research Conclusions) — CLOSED v1 (revised)

## What is documented (facts)

### Pagination
- Pagination model is **page-based** using `page` + `maxResults`.
- Default `maxResults`: 20
- InfoJobs **explicitly recommends** `maxResults <= 50`.
- Responses include `totalPages`.

### Delta / incremental support
- Only coarse-grained delta support via `sinceDate`: `_24_HOURS | _7_DAYS | _15_DAYS | ANY`
- No cursor / no absolute timestamp delta.

### Rate limits
- **No official rate limits are documented** (no req/min, req/day, etc.).

---

## Decisions for MVP implementation (based on findings)

### 1) Pagination strategy (list endpoint)
- Use `GET /api/9/offer` page by page.
- Defaults:
  - `maxResults = 30–50`
  - start `page = 0`
- For each page:
  - Persist the **full list response fields we decided to keep** (since the request cost is already paid).
  - Do not assume we can traverse all pages in a single run; the run must be safely interruptible.

### 2) Backfill first, then daily deltas
- Phase A (bootstrap/backfill):
  - run with `sinceDate = _15_DAYS` (and/or `_7_DAYS`) until we build a good base of recent historical offers.
- Phase B (steady state):
  - switch to daily runs using `sinceDate = _24_HOURS`.

### 3) Detail calls (`GET /offer/{offerId}`)
- Treat offer detail calls as **more expensive** than list calls because they multiply with volume.
- Strategy:
  - Fetch details only as request budget allows.
  - Prioritize:
    - offers from **new companies**
    - offers not seen before
- If throttling occurs:
  - stop detail fetching and resume next run.

### 4) Rate limiting & backoff (defensive approach)
- Since limits are unknown, we will measure and adapt.

TODO: (important):
- Add instrumentation to log:
  - total requests per run (list vs detail)
  - first occurrence of `429` (or other throttling signals)
  - timestamps and the last successful request index
  - per-endpoint pacing (sleep/backoff) applied
- Persist a brief “rate-limit observations” summary in run logs so we can tune caps/sleeps based on real behavior.

### 5) Prefiltering & duplicate suspicion (future optimization)
- If multiple offers from the same company look identical (title + requirement text + same key metadata),
  treat them as lower priority for detail fetching.

TODO:
- Define and implement this as a queueing/priority heuristic only (not a hard dedupe rule).
- Track its impact in logs (how many details were deprioritized due to “likely duplicate”).

---

## Final conclusion
- Page-based pagination + coarse `sinceDate` delta.
- No published rate limits → we must self-throttle and instrument real-world limits.
- Recommended execution: backfill (`_15_DAYS`/`_7_DAYS`) then daily (`_24_HOURS`), with detail fetches budgeted and prioritized.
