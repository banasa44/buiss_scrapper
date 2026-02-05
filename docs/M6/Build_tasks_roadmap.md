## M6 — Sheets Feedback Loop & Company Lifecycle

Goal: allow the client to resolve companies from Google Sheets and propagate those decisions back into the system database safely.

- [DEFINE] Specify feedback semantics and lifecycle rules ✔
- [DECISION] Choose feedback ingestion strategy ✔

---

### [BUILD] Implement Sheets feedback processor

#### M6.BUILD-1 – Core feedback reader

- Create function to read only `company_id + resolution` from Sheets
- Reuse existing GoogleSheetsClient primitives
- Implement minimal result type (company_id → resolution map)
- Add defensive parsing + validation (reuse existing parsing utils)
- Logging for malformed rows
- Duplicate detection + warnings

#### M6.BUILD-2 – DB feedback comparison layer

- Implement loader for current DB company resolutions
- Compute diff: (sheet value vs DB value)
- Detect transitions that require actions
- Produce deterministic “change plan” structure

#### M6.BUILD-3 – Safety & validation layer

- Validate allowed transitions only
- Ignore unknown company_ids
- Guard against impossible states
- Add dry “planning only” mode for debugging
- Structured logs for planned changes

#### M6.BUILD-4 – Nightly window gating

- Implement time-window guard (03:00–06:00)
- Environment/timezone handling
- Skip logic when outside window
- Clear logs explaining skips

#### M6.BUILD-5 – Orchestration entrypoint

- High-level function `processSheetsFeedback()`
- Wire together: read → diff → actions
- Best-effort behavior (never throw)
- Result object with counters and errors

---

### [BUILD] Implement company resolution workflow

#### M6.BUILD-6 – Extend Company model (if needed)

- Ensure `resolution` field exists in DB schema
- Map sheet values 1:1 to DB values
- Default new companies to PENDING

#### M6.BUILD-7 – Resolution persistence

- Implement repo method to update company resolution
- Idempotent updates (no-op if same value)
- Audit logging for every change

#### M6.BUILD-8 – Offer cleanup workflow

- Implement deletion of all offers for resolved companies
- Remove related signal/match data if applicable
- Ensure metrics remain untouched
- Ensure process is idempotent

#### M6.BUILD-9 – Ingestion protection

- Modify ingestion pipeline to:
  - Ignore new offers from resolved companies
  - Skip aggregation for resolved companies
  - Fast-path “ignore if resolved” checks

#### M6.BUILD-10 – Metrics preservation guarantees

- Ensure resolution changes never modify:
  - historical metrics
  - company-level aggregates
  - category/keyword statistics

#### M6.BUILD-11 – Feedback audit logging

- Detailed logs for:
  - companies resolved
  - companies reverted to PENDING
  - deletions performed
  - ignored rows
- Structured counters

---

### [BUILD] Pipeline Integration

#### M6.BUILD-12 – Integrate into ingestion lifecycle

- Hook `processSheetsFeedback()` into run pipeline
- Execute only after:  
  ingest → aggregate → export to Sheets

#### M6.BUILD-13 – Time-gated execution

- Ensure feedback processor only runs in nightly window
- Non-fatal skip outside window

#### M6.BUILD-14 – Final reporting

- Add dedicated feedback log section
- Do NOT mix with RunCounters
- Clear separation from ingestion metrics

---

### [ITEST] Add gated integration tests

#### M6.ITEST-1 – Offline E2E tests

- Full pipeline with mocked Sheets HTTP
- Verify:
  - feedback read
  - DB updates
  - deletions
  - ignore logic

#### M6.ITEST-2 – Safety cases

- Unknown company_ids
- malformed rows
- duplicates
- API failures

#### M6.ITEST-3 – Live gated tests (after auth ready)

- Real Google Sheets end-to-end verification
- Manual gated execution only

---

## Result After M6

At the end of M6 we will have:

- A safe two-way loop between DB and Sheets
- Client-controlled lifecycle decisions
- Automatic cleanup of irrelevant companies
- Metrics preserved for analytics
- Zero-risk ingestion flow
- Fully testable behavior
