# Project Audit Report — Run Lifecycle + Client Interchangeability + Roadmap Coherence

**Audit Date:** January 26, 2026  
**Scope:** M1.4-B implementation status, client abstraction, and milestone alignment

---

## 1. Snapshot

### Key Modules Relevant to This Audit

| Area                          | Files                                                           | Status      |
| ----------------------------- | --------------------------------------------------------------- | ----------- |
| **Run Lifecycle**             | `src/ingestion/runLifecycle.ts`, `src/db/repos/runsRepo.ts`     | Implemented |
| **Types (Runs)**              | `src/types/db.ts` (RunCounters, RunStatus, IngestionRun\*)      | Implemented |
| **JobOffersClient Interface** | `src/interfaces/clients/jobOffersClient.ts`                     | Implemented |
| **InfoJobs Client**           | `src/clients/infojobs/infojobsClient.ts`, `mappers.ts`          | Implemented |
| **Provider-Agnostic Types**   | `src/types/clients/job_offers.ts`                               | Implemented |
| **InfoJobs-Specific Types**   | `src/types/clients/infojobs.ts`                                 | Implemented |
| **DB Repos**                  | `src/db/repos/companiesRepo.ts`, `offersRepo.ts`, `runsRepo.ts` | Implemented |
| **DB Connection**             | `src/db/connection.ts`                                          | Implemented |
| **Main Entry**                | `src/main.ts`                                                   | Stub only   |

### What Exists But Is Not Yet Wired

- `withRun()` helper exists but is **not used** in `main.ts`
- Ingestion functions (M1.4-C/D) to call company/offer repos are **not implemented**
- No orchestration layer connecting client → run lifecycle → DB writes

---

## 2. Run Lifecycle Audit

### 2.1 Findings vs Spec (B_implement_run_lifecycle.md)

| Requirement                                                 | Status     | Notes                                                                                                                                              |
| ----------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startRun(provider, query?)` → returns `runId`              | ✅ PASS    | Correctly inserts into `ingestion_runs`, returns lastInsertRowid                                                                                   |
| `query_fingerprint = NULL` for now                          | ✅ PASS    | Explicitly set to null                                                                                                                             |
| `finishRun(runId, status, patch?)` sets `finished_at = now` | ✅ PASS    | Uses `new Date().toISOString()`                                                                                                                    |
| `finishRun` sets `status`                                   | ✅ PASS    | Passes "success" or "failure"                                                                                                                      |
| `finishRun` updates counters from `patch`                   | ⚠️ PARTIAL | Only `pages_fetched`, `offers_fetched`, `errors_count`—missing `requests_count`, `http_429_count` in lifecycle (acceptable per spec: "leave NULL") |
| `withRun()` creates exactly 1 run                           | ✅ PASS    | Calls `startRun()` once                                                                                                                            |
| `withRun()` finalizes in `finally`                          | ✅ PASS    | Uses `try/finally` block correctly                                                                                                                 |
| On error: status = "failure", rethrows                      | ⚠️ RISK    | See risk analysis below                                                                                                                            |
| No ingestion logic in this task                             | ✅ PASS    | Lifecycle helpers only                                                                                                                             |

### 2.2 Risks Identified

#### Risk 1: `withRun()` Does Not Pass Counters on Failure

```typescript
// Current code in runLifecycle.ts
finally {
  finishRun(runId, succeeded ? "success" : "failure");
}
```

**Problem:** When the wrapped function (`fn`) fails, no counters are passed to `finishRun()`. If the function partially executed (e.g., fetched 3 pages before failing), those counters are lost.

**Severity:** Medium — run telemetry is incomplete on failures.

#### Risk 2: No Counter Accumulation Mechanism in `withRun()`

**Problem:** The `withRun()` helper signature is:

```typescript
fn: (runId: number) => Promise<T>;
```

The wrapped function receives only `runId`. There's no standard way for `fn` to report intermediate counters back to `withRun()` for final patching. The caller must manually call `finishRun()` with counters before returning or throwing.

**Severity:** Low — The design expects callers to manage counters internally. However, if `fn` throws unexpectedly, counters are lost.

#### Risk 3: Missing Type Safety for RunStatus

**Observation:** `RunStatus` is defined as `"success" | "failure"` in `src/types/db.ts`, but `IngestionRunUpdate.status` is typed as `string | null`. This allows invalid status values to slip through `repoFinishRun()`.

**Severity:** Low — Currently only `runLifecycle.ts` calls `finishRun()` with valid literals. But future callers could pass invalid values.

#### Risk 4: No Defensive `finally` in `repoFinishRun()`

If `db.prepare().run()` throws (e.g., disk full, schema mismatch), the run remains without `finished_at`. However, this is a **fatal** DB error scenario which should crash per project rules, so this is acceptable.

**Severity:** Acceptable — Fatal DB errors should stop the process.

### 2.3 Minimal Recommended Changes (Ordered Checklist)

1. [ ] **Extend `withRun()` to accept a counter accumulator or callback**
   - Option A: Pass a mutable `{ counters: RunCounters }` ref to `fn`
   - Option B: Have `fn` return `{ result: T, counters: RunCounters }` instead of just `T`
   - Option C: Keep current design, document that callers must call a separate "patchCounters" before throwing

2. [ ] **Patch counters on failure path**
   - If using Option A/B, ensure `finally` block reads accumulated counters even on failure

3. [ ] **Tighten `IngestionRunUpdate.status` type**
   - Change from `string | null` to `RunStatus | null` in `src/types/db.ts`

4. [ ] **Add JSDoc to clarify counter semantics**
   - Document in `withRun()` whether counters should be patched by `fn` or post-hoc

---

## 3. Client Interchangeability Audit

### 3.1 Interface Contract Quality

**`src/interfaces/clients/jobOffersClient.ts`**

| Aspect                                    | Assessment                                               |
| ----------------------------------------- | -------------------------------------------------------- |
| Provider identifier (`readonly provider`) | ✅ Good — Enforces provider tracking                     |
| `searchOffers(query)` signature           | ✅ Good — Uses `SearchOffersQuery` (provider-agnostic)   |
| `searchOffers` return type                | ✅ Good — Returns `SearchOffersResult` with `SearchMeta` |
| `getOfferById(id)` signature              | ✅ Good — Uses `string` id (generic)                     |
| `getOfferById` return type                | ✅ Good — Returns `JobOfferDetail` (normalized)          |

**What's Missing:**

- No `healthCheck()` or `validateAuth()` method for pre-flight validation
- No `close()` or cleanup method (not critical for HTTP clients)
- No explicit error contract (what errors should callers expect?)

### 3.2 Coupling Hotspots

#### Hotspot 1: `Provider` Type Includes InfoJobs Literal

**File:** `src/types/clients/job_offers.ts:12`

```typescript
export type Provider = "infojobs" | (string & {});
```

**Assessment:** This is **acceptable** — the `(string & {})` intersection allows future providers while keeping IntelliSense for known ones. No coupling issue.

#### Hotspot 2: `mappers.ts` Hardcodes `provider: "infojobs"`

**File:** `src/clients/infojobs/mappers.ts:105, 199`

```typescript
ref: {
  provider: "infojobs",  // Hardcoded
  id: raw.id,
  url: raw.link,
},
```

**Assessment:** ✅ Correct — Mappers are InfoJobs-specific by design. The normalized output correctly tags the provider.

#### Hotspot 3: InfoJobs Domain Filtering in `mappers.ts`

**File:** `src/clients/infojobs/mappers.ts:178-184`

```typescript
// InfoJobs-specific: reject internal InfoJobs domains
if (websiteDomain && websiteDomain.includes("infojobs.")) {
  debug("InfoJobs mapper: filtering out internal InfoJobs domain", {...});
  websiteDomain = null;
}
```

**Assessment:** ✅ Correct — This is provider-specific logic contained within the provider's mapper. Does not leak into shared code.

#### Hotspot 4: `InfoJobsClient` in `main.ts`

**File:** `src/main.ts:2`

```typescript
import { InfoJobsClient } from "@/clients/infojobs";
```

**Assessment:** ⚠️ Coupling exists but is intentional for MVP. **Future improvement:** Use factory pattern or dependency injection.

#### Hotspot 5: DB Repos Use `provider: string`

**Files:** `src/db/repos/offersRepo.ts`, `companiesRepo.ts`

**Assessment:** ✅ Good — DB layer uses `string` for provider, not InfoJobs-specific types. Fully agnostic.

#### Hotspot 6: InfoJobs Types Exported via Main Barrel

**File:** `src/types/index.ts:5`

```typescript
export * from "./clients/infojobs";
```

**Assessment:** ⚠️ Minor issue — InfoJobs-specific types (`InfoJobsOfferListItem`, etc.) are exported from the main types barrel. This doesn't create runtime coupling but pollutes the type namespace.

**Recommendation:** Keep InfoJobs types internal to `src/clients/infojobs/`. Other modules should only import from `@/types` for normalized types.

### 3.3 Minimal Refactor Recommendations (Ordered Checklist)

1. [ ] **Create client factory or registry pattern** (optional, M5 scope)

   ```typescript
   // src/clients/index.ts
   export function createClient(provider: Provider): JobOffersClient {
     switch (provider) {
       case "infojobs":
         return new InfoJobsClient();
       default:
         throw new Error(`Unknown provider: ${provider}`);
     }
   }
   ```

2. [ ] **Remove InfoJobs types from main barrel export**
   - Edit `src/types/index.ts` to remove `export * from "./clients/infojobs"`
   - InfoJobs types should only be imported within `src/clients/infojobs/`

3. [ ] **Document error contract for `JobOffersClient`**
   - Add JSDoc specifying what errors `searchOffers` and `getOfferById` may throw
   - Distinguish auth errors (fatal) from transient errors (recoverable)

4. [ ] **Add optional `validateCredentials()` method to interface** (optional, low priority)
   - Useful for pre-flight checks before starting a run

### 3.4 InfoJobs Leakage Into Ingestion/DB? — **NO**

✅ The ingestion module (`src/ingestion/`) currently contains **only run lifecycle helpers** with no InfoJobs-specific references.

✅ DB repos use generic `provider: string` and do not reference InfoJobs types.

✅ The mappers correctly output normalized `JobOfferSummary` / `JobOfferDetail` types.

---

## 4. Roadmap Coherence

### 4.1 What Aligns

| Milestone                          | Expected        | Actual                                                          |
| ---------------------------------- | --------------- | --------------------------------------------------------------- |
| M0 — InfoJobs connector            | Complete        | ✅ `InfoJobsClient` implemented with pagination, error handling |
| M1.1 — Define DB schema            | Complete        | ✅ Migrations exist (`0001_init.sql`, `0002_...`)               |
| M1.2 — Build database layer        | Complete        | ✅ `connection.ts`, `migrate.ts`, repos implemented             |
| M1.3 — Define company identity     | Complete        | ✅ `companiesRepo` implements identity resolution               |
| M1.4-A — Define ingestion contract | Complete        | ✅ `A_define_ingestion&counters.md` spec exists                 |
| M1.4-B — Implement run lifecycle   | **In Progress** | ⚠️ Helpers exist but need counter-on-failure fix                |

### 4.2 What Is Out of Order / Risky

#### Issue 1: M1.4-C/D Not Started (Ingestion Write Path)

**Expected next:** After M1.4-B, implement:

- M1.4-C: Company persistence (upsert company + source)
- M1.4-D: Offer upsert (idempotent)

**Current state:** Repos (`upsertCompany`, `upsertOffer`) exist but **no ingestion orchestrator** connects:

```
Client.searchOffers() → Run lifecycle → Company/Offer upserts
```

**Risk:** Without the orchestration layer, the run lifecycle helpers cannot be integration-tested with real data flow.

#### Issue 2: No Integration Test for DB Migration (M1.5)

**Spec:** `05_itest_db_migration.md` requires a smoke test that:

- Creates temp DB
- Runs migrations
- Asserts tables exist

**Current state:** No test files found in workspace.

**Risk:** Schema changes could break silently without CI feedback.

#### Issue 3: `main.ts` Is a Stub

```typescript
// TODO: Add search/detail calls once implemented
```

**Risk:** The system cannot be executed end-to-end. This is expected at M1.4-B stage but should be prioritized immediately after.

### 4.3 Suggested Next Steps (1–3 Tasks)

#### Step 1: Finalize M1.4-B — Fix Counter Propagation on Failure

**Scope:** Small fix to `withRun()` or document the expected pattern for callers.

**Acceptance:**

- Counters are captured even when `fn` throws
- JSDoc clarifies counter management

#### Step 2: Implement M1.4-C — Company Persistence Function

**Scope:** Create `src/ingestion/companyPersistence.ts` (or similar) with:

```typescript
export function resolveAndPersistCompany(
  company: JobOfferCompany,
  provider: Provider,
): { companyId: number; skipped: boolean; reason?: string };
```

**Acceptance:**

- Uses `upsertCompany` + `upsertCompanySource` from repos
- Handles "company unidentifiable" case (log + skip)
- Returns `companyId` for offer linking

#### Step 3: Implement M1.4-D — Offer Upsert Orchestration

**Scope:** Create ingestion function that:

1. Resolves company
2. Upserts offer with resolved `company_id`
3. Handles per-record errors (log + skip + continue)

**Acceptance:**

- `ingestOffer(detail: JobOfferDetail, provider: Provider, runId: number)` returns success/skip/fail
- Updates run counters

---

## 5. Summary

### What Matters Most

1. **Run lifecycle is 90% complete** — The `withRun()` pattern correctly ensures `finished_at` is always set. The gap is counter propagation on failure, which is a small fix.

2. **Client interchangeability is solid** — The `JobOffersClient` interface cleanly separates provider-specific code from normalized types. InfoJobs-specific logic is properly contained in `src/clients/infojobs/`. No coupling leaks into ingestion or DB layers.

3. **The critical missing piece is M1.4-C/D** — The repos exist, the lifecycle exists, but there's no orchestration layer to actually ingest offers. This is the natural next step and should be prioritized.

4. **Minor hygiene:** Remove InfoJobs types from main barrel export; tighten `IngestionRunUpdate.status` type.

5. **Testing gap:** No DB migration smoke test (M1.5) yet. Should be implemented alongside or immediately after M1.4-D to catch schema issues early.

**Recommendation:** Complete M1.4-B counter fix, then focus on M1.4-C/D as a single unit of work. These three pieces together will enable the first true end-to-end ingestion flow.
