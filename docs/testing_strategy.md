# Testing Strategy (Global)

This document defines the **testing philosophy, scope, and structure** for the project.
It is intentionally **technical, concise, and normative**.
All current and future tests (ingestion, scoring, matching, exports) must follow these rules.

---

## Goals

Testing must provide **real confidence**, not superficial coverage.

Primary risks this strategy is designed to catch:

- Data corruption or duplication (DB idempotency)
- Boundary violations (client-agnostic guarantees)
- Silent failures on malformed external data
- Regressions in normalization and identity logic
- Pipeline wiring errors (client → ingestion → DB)

---

## Testing Layers

We use **three complementary layers**. All are required.

### 1) Unit Tests (Pure Logic)

**Purpose:** Verify deterministic logic with zero side effects.

**What is tested:**

- Pure utilities (`normalizeCompanyName`, `extractWebsiteDomain`, etc.)
- Normalization and identity helpers
- Provider mappers (raw payload → canonical domain types)

**What is NOT tested:**

- Database behavior
- Repositories
- Orchestration / pipelines

**Rules:**

- No DB
- No filesystem
- No network
- No mocks unless strictly necessary (rare)

---

### 2) Integration Tests (Database – SQLite Real)

**Purpose:** Verify correctness of persistence, idempotency, and overwrite semantics.

**System under test:**

- Real SQLite database
- Real migrations
- Real repositories
- Real ingestion logic (`runOfferBatchIngestion`, persistence helpers)

**What is tested:**

- Idempotency (same batch ingested twice → no duplicates)
- Overwrite semantics on upsert
- Foreign key integrity (offers ↔ companies)
- Bad record handling (log + skip, run completes)

**Rules:**

- **No repository mocks**
- **No in-memory fake DB**
- SQLite is the system of record, even in tests
- One **fresh temporary DB per test** (robustness > speed)

---

### 3) E2E Offline Tests (Pipeline-Level)

**Purpose:** Validate the **full data flow** without external dependencies.

**Flow tested:**
Mocked HTTP → Provider Client → Mapper → Ingestion Pipeline → DB

**Key characteristics:**

- No live external calls
- HTTP layer is mocked using fixtures
- Database is real (SQLite + migrations)

**What is tested:**

- Client-agnostic design (pipeline works with canonical data regardless of provider)
- Correct wiring between layers
- Normalization + persistence working together
- Realistic edge cases from provider payloads

**Important:**
This is the **most important test layer** for confidence.

---

## Fixtures

Fixtures are **explicit test inputs**, not mocks.

**Used for:**

- Provider HTTP responses (InfoJobs, future providers)
- Edge cases (missing fields, hidden companies, malformed records)

**Location:**
tests/fixtures/
infojobs/
search_response.json
offer_detail.json
edge_missing_company.json

Fixtures should resemble **real provider payloads**, not simplified objects.

---

## Mocking Policy

Mocks are allowed **only** where external systems are involved.

| Layer          | Mocks Allowed | Notes                 |
| -------------- | ------------- | --------------------- |
| Unit           | Rarely        | Prefer pure functions |
| Integration DB | ❌ Never      | Real DB required      |
| E2E Offline    | ✅ HTTP only  | DB is always real     |

**Never mock:**

- Repositories
- Database
- Ingestion logic
- Run lifecycle

---

## Database Lifecycle in Tests

- A **new SQLite database** is created per test
- Migrations are applied before each test
- Database is destroyed after test completion

**Rationale:**

- Zero cross-test contamination
- Deterministic behavior
- Eliminates flakiness

Performance is acceptable at current project scale.

---

## Pipeline Testing Entry Points

E2E tests must target **pipeline entry functions**, not `main.ts`.

**Rules:**

- Pipelines live under `src/ingestion/`
- Pipelines orchestrate:
  - Provider client
  - Mapping to canonical types
  - Ingestion + persistence
- `main.ts` is intentionally excluded from tests

This ensures:

- Testability
- Clean separation of concerns
- No dead code or test-only branches

---

## Framework

- **Test runner:** Vitest
- **Assertions:** Built-in Vitest expect
- **Coverage:** Secondary concern (correctness > coverage %)

---

## Extensibility

This strategy is designed to scale to:

- Additional providers (Indeed, LinkedIn, etc.)
- Offer lifecycle processing
- Company scoring / analysis
- Export pipelines

New features must plug into **existing test layers**, not invent new ones.

---

## Summary Rules

- Prefer **real systems** over mocks
- Test **boundaries**, not implementations
- E2E offline tests are mandatory for ingestion pipelines
- If a test cannot fail meaningfully, it should not exist
