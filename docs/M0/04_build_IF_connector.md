## 4) [BUILD] Implement InfoJobs connector

**Objective:** Build a working, testable connector that can fetch offers for a query and (if needed) fetch offer details.

**Key considerations:**

- Clear interface:
  - `searchOffers(queryParams) -> OfferSummary[]`
  - `getOfferDetail(offerId) -> OfferDetail`
- Handle pagination according to the research (stop conditions, caps).
- Basic resilience:
  - timeouts, retries with backoff for transient errors
  - clear errors for auth failures
- Minimal normalization at the connector boundary:
  - map API payloads into internal `JobPosting` shape (even if partial)
- Logging:
  - per-query counts (fetched pages, offers returned)
  - error summaries without being noisy

**Desired output:**

- A connector module callable from a simple script/runner that can:
  - run 1 query and fetch a small batch successfully
  - print/log a small sample of normalized records (id, title, company label, link, published date)
- A minimal configuration stub for credentials and a sample query (kept out of git via env/config patterns).


## Implementation Notes: constraints + slicing

### Non-negotiable constraints
- Connector = **fetch + normalize only**. **NO DB writes**, NO scoring, NO dedupe.
- Use centralized **normalized types** (provider-agnostic):
  - `JobOfferSummary`
  - `JobOfferDetail`
  - (types go in `src/types/`, e.g. `job_offers.ts`)
- **No magic numbers** in logic: caps/backoff/timeouts in config/constants (`src/constants/`).
- No placeholders/mocks. If blocked: add explicit `TODO:` and stop.

### Auth (must be implemented in the connector)
- Env:
  - `IJ_CLIENT_ID`
  - `IJ_CLIENT_SECRET`
- Build `Authorization: Basic base64(clientId:clientSecret)`
- Fail fast if missing creds. Surface 401/403 clearly.

### API endpoints (MVP)
- List/search: `GET /api/9/offer`
  - params we will use: `q`, `country=espana`, optional `category[]`, `subcategory[]`, `sinceDate`, `order`, `page`, `maxResults`
- Detail: `GET /api/7/offer/{offerId}`

### Pagination + caps
- Pagination is `page`-based, `maxResults` recommended <= 50.
- Implement stop conditions:
  - stop at `totalPages`
  - AND stop at configured caps: `CONNECTOR_MAX_PAGES_PER_QUERY`, `CONNECTOR_MAX_OFFERS_PER_QUERY` (optional)
- Keep the full list response fields we decided to store in the normalized output (cheap once the request is made).

### Rate limiting / resilience (shared)
- Build a reusable HTTP wrapper (for future sources):
  - timeout
  - retries for transient errors
  - exponential backoff (+ small jitter)
  - detect `429`; respect `Retry-After` if present
- Track counters per run (log summary):
  - requests_total, requests_list, requests_detail
  - retries_total, rateLimit_429_count
  - total_backoff_sleep_ms
- `TODO` later: persist these observations (for tuning), not just console logs.

### Logging (minimal, useful)
- Per query: pagesFetched, offersFetched.
- Per run: totals + 429/retry counters.
- Errors: one-line summary with context (query, page, offerId).

---

## Implementation slicing (do in order; separate prompts)

### 4.1 BUILD — Shared HTTP + Auth helper
- Add HTTP client wrapper: `request({ method, url, headers, timeoutMs })`
- Add retry/backoff + 429 handling + counters.
- Add helper: `buildInfoJobsAuthHeader()` reading env vars.
- Output: a callable function that can hit an URL with Basic auth + returns JSON.

### 4.2 BUILD — Types + normalized mapping contracts
- Add `src/types/job_offers.ts`: `JobOfferSummary`, `JobOfferDetail`, plus small nested structs needed.
- Add minimal raw-to-normalized mapping functions for InfoJobs list + detail payloads.
- Keep InfoJobs-specific fields inside normalized “extra/metadata” object if needed (but still typed).

### 4.3 BUILD — `searchOffers(query)` (list endpoint)
- Implement: `searchOffers(params) -> JobOfferSummary[]`
- Loop pages with caps + stop at `totalPages`.
- Use `country=espana` always.
- Log per-query counts.

### 4.4 BUILD — `getOfferDetail(offerId)`
- Implement: `getOfferDetail(offerId) -> JobOfferDetail`
- Budget detail calls via config cap (enforced by runner later).
- Log per-offer failures without stopping whole run.

### 4.5 BUILD — Minimal runner (manual verification)
- Run 1 sample query (small caps).
- Print/log first N normalized summaries: `{id,title,companyId,companyName,link,published/updated}`.
- No DB, no Sheets.
