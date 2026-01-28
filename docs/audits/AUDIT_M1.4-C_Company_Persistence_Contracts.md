# Audit Report: M1.4-C Company Persistence Contracts

**Date:** January 27, 2026  
**Scope:** Pre-implementation audit for M1.4-C (Company persistence + provider source link)  
**Status:** Read-only audit — no production code changes

---

## Project Rules Confirmation (from `docs/project-layout.md`)

| Concern          | Location                                                                     | Status          |
| ---------------- | ---------------------------------------------------------------------------- | --------------- |
| Types            | `src/types/` with barrel exports via `index.ts`                              | ✅ Confirmed    |
| Constants        | `src/constants/` with barrel exports                                         | ✅ Confirmed    |
| Logging          | Micro-logger wrapper in `src/logger/` — use `debug`, `info`, `warn`, `error` | ✅ Confirmed    |
| No `console.log` | Use project logger instead                                                   | ✅ Must enforce |
| Repos            | `src/db/repos/` — thin data access layer                                     | ✅ Confirmed    |

---

## A) Repo Contract Summary

### A.1) Global Company Upsert: `upsertCompany()`

**Location:** [src/db/repos/companiesRepo.ts](../src/db/repos/companiesRepo.ts#L27)

| Property            | Value                                        |
| ------------------- | -------------------------------------------- |
| **Function**        | `upsertCompany(input: CompanyInput): number` |
| **Parameter shape** | `CompanyInput` (see below)                   |
| **Return type**     | `number` (the company `id`)                  |

**`CompanyInput` type** (from `src/types/db.ts:24-32`):

```typescript
type CompanyInput = {
  name_raw?: string | null;
  name_display?: string | null;
  normalized_name?: string | null;
  website_url?: string | null;
  website_domain?: string | null;
};
```

**Conflict handling strategy:**

1. **If `website_domain` is present** (strongest identity):
   - Check: `SELECT id FROM companies WHERE website_domain = ?`
   - If exists → UPDATE (COALESCE-enrich: does NOT overwrite with null)
   - If not exists → INSERT

2. **Else if `normalized_name` is present** (fallback identity):
   - Check: `SELECT id FROM companies WHERE normalized_name = ?`
   - If exists → UPDATE (COALESCE-enrich)
   - If not exists → INSERT

3. **If neither present** → **THROWS** error:
   > `"Cannot upsert company: neither website_domain nor normalized_name provided."`

**⚠️ Important:** The current UPDATE uses `COALESCE(?, existing_value)` — it **enriches** but does NOT overwrite existing values with null. This differs from the "overwrite-based" rule in `A_define_ingestion&counters.md` (rule 2).

---

### A.2) Provider Source Link Upsert: `upsertCompanySource()`

**Location:** [src/db/repos/companiesRepo.ts](../src/db/repos/companiesRepo.ts#L123)

| Property            | Value                                                    |
| ------------------- | -------------------------------------------------------- |
| **Function**        | `upsertCompanySource(input: CompanySourceInput): number` |
| **Parameter shape** | `CompanySourceInput` (see below)                         |
| **Return type**     | `number` (the company_source `id`)                       |

**`CompanySourceInput` type** (from `src/types/db.ts:50-58`):

```typescript
type CompanySourceInput = {
  company_id: number; // Required FK
  provider: string; // Required
  provider_company_id?: string | null;
  provider_company_url?: string | null;
  hidden?: number | null;
  raw_json?: string | null;
};
```

**Conflict handling strategy:**

1. **If `provider_company_id` is present:**
   - Check: `SELECT id FROM company_sources WHERE provider = ? AND provider_company_id = ?`
   - If exists → UPDATE (COALESCE-enrich)
   - If not exists → INSERT

2. **If `provider_company_id` is absent:**
   - **Always INSERT** (no conflict check)
   - Multiple sources per `(company_id, provider)` are allowed

**Note:** The `company_id` must reference a valid company. The repo does NOT auto-create companies — caller must upsert company first.

---

### A.3) Query Functions (Read-only)

| Function                                  | Return                       | Notes                     |
| ----------------------------------------- | ---------------------------- | ------------------------- |
| `getCompanyById(id)`                      | `Company \| undefined`       | Direct lookup             |
| `getCompanySourceById(id)`                | `CompanySource \| undefined` | Direct lookup             |
| `getCompanySourcesByCompanyId(companyId)` | `CompanySource[]`            | All sources for a company |

---

## B) Identity Evidence Rules (Global)

### B.1) Minimum Evidence Required to Persist a Company

Per `upsertCompany()` implementation, **at least ONE** of:

- `website_domain` (strongest signal)
- `normalized_name` (fallback signal)

If **neither** is present → `upsertCompany()` throws an error.

**Note:** `provider_company_id` is NOT sufficient by itself to create a global company. It's only stored in `company_sources` as a link.

---

### B.2) What is Implemented in `companyIdentity.ts`

**Location:** [src/utils/companyIdentity.ts](../src/utils/companyIdentity.ts)

| Function                        | Status         | Description                                                                                                        |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `normalizeCompanyName(raw)`     | ✅ Implemented | Returns normalized string (trim, lowercase, strip diacritics, collapse whitespace, remove trailing legal suffixes) |
| `extractWebsiteDomain(url)`     | ✅ Implemented | Returns lowercase hostname without `www.` prefix, or `null` if invalid                                             |
| `pickCompanyWebsiteUrl(fields)` | ✅ Implemented | Picks best URL from `{corporateWebsiteUrl, websiteUrl, web}` by priority                                           |

**What is NOT implemented:**

- ❌ **No "can identify" predicate** — a function to determine if a `JobOfferCompany` has sufficient identity evidence
- ❌ **No domain filter for provider URLs** — `extractWebsiteDomain` is provider-agnostic; filtering out InfoJobs/LinkedIn domains must be done in mapper layer
- ❌ **No helper to build `CompanyInput` from `JobOfferCompany`** — conversion logic does not exist

---

### B.3) Normalization Helpers Summary

| Helper                  | Location             | Input                                       | Output                  |
| ----------------------- | -------------------- | ------------------------------------------- | ----------------------- |
| `normalizeCompanyName`  | `companyIdentity.ts` | raw name string                             | normalized name string  |
| `extractWebsiteDomain`  | `companyIdentity.ts` | full URL                                    | domain string or `null` |
| `pickCompanyWebsiteUrl` | `companyIdentity.ts` | `{corporateWebsiteUrl?, websiteUrl?, web?}` | best URL or `null`      |

---

## C) `company_sources` Table Analysis

### C.1) Schema (from `migrations/0002_company_sources_and_global_companies.sql`)

```sql
CREATE TABLE company_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,           -- FK to companies.id
  provider TEXT NOT NULL,                 -- e.g., "infojobs"
  provider_company_id TEXT,               -- nullable (hidden companies)
  provider_company_url TEXT,              -- nullable
  hidden INTEGER,                         -- nullable (0/1)
  raw_json TEXT,                          -- nullable
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Unique constraint when provider_company_id exists
CREATE UNIQUE INDEX uq_company_sources_provider_id
  ON company_sources(provider, provider_company_id)
  WHERE provider_company_id IS NOT NULL;
```

### C.2) Purpose of `company_sources`

Links a **global company** to **provider-specific identifiers**:

- One global company can have multiple sources (e.g., same company on InfoJobs + LinkedIn)
- Tracks provider-specific metadata (`hidden`, `provider_company_url`)

### C.3) Unique Constraint Behavior

The unique index `uq_company_sources_provider_id` only applies when `provider_company_id IS NOT NULL`.

- If a company appears multiple times on the same provider **without** an ID → multiple rows allowed
- If a company has a `provider_company_id` → upsert semantics apply

---

## D) `JobOfferCompany` Type Analysis

**Location:** [src/types/clients/job_offers.ts](../src/types/clients/job_offers.ts#L36-45)

```typescript
type JobOfferCompany = {
  id?: string; // provider_company_id
  name?: string; // display name
  nameRaw?: string; // raw name from provider
  normalizedName?: string; // pre-computed normalized name
  websiteUrl?: string; // full URL
  websiteDomain?: string; // extracted domain
  hidden?: boolean; // provider-specific flag
};
```

### D.1) Mapping to DB Types

| `JobOfferCompany` field | → `CompanyInput` field | → `CompanySourceInput` field |
| ----------------------- | ---------------------- | ---------------------------- |
| `id`                    | —                      | `provider_company_id`        |
| `name`                  | `name_display`         | —                            |
| `nameRaw`               | `name_raw`             | —                            |
| `normalizedName`        | `normalized_name`      | —                            |
| `websiteUrl`            | `website_url`          | —                            |
| `websiteDomain`         | `website_domain`       | —                            |
| `hidden`                | —                      | `hidden` (as 0/1)            |

---

## E) Gaps and Decisions Needed for M1.4-C

### E.1) Missing Implementation: Company Identifiability Check

**Gap:** No predicate exists to determine if a `JobOfferCompany` can be identified.

**Recommended Decision:** Add a utility function:

```typescript
function canIdentifyCompany(company: JobOfferCompany): boolean {
  return !!(company.websiteDomain || company.normalizedName || company.id);
}
```

**Note:** Per `A_define_ingestion&counters.md` rule 3, **any** of these is sufficient for identity:

- `websiteDomain`
- `normalizedName`
- `providerCompanyId`

However, `upsertCompany()` currently requires `website_domain` OR `normalized_name` (NOT `provider_company_id` alone). This is correct because `provider_company_id` creates a **source link**, not a **global company**.

### E.2) Update Semantics Mismatch

**Current behavior:** `upsertCompany()` uses COALESCE (enrich, don't overwrite nulls).

**Spec in `A_define_ingestion&counters.md` rule 2:** Upserts should be **overwrite-based** (null in input → NULL in DB).

**Decision needed:** Does company upsert follow "enrich" or "overwrite" semantics?

- **Recommendation:** Keep COALESCE for companies (enrich mode) — companies accumulate evidence over time.
- Clarify this is intentional and document it.

### E.3) Missing Converter: `JobOfferCompany` → `CompanyInput`

**Gap:** No function to convert `JobOfferCompany` to `CompanyInput`.

**Recommendation:** Add to `companyIdentity.ts` or a new `companyMapper.ts`:

```typescript
function toCompanyInput(company: JobOfferCompany): CompanyInput {
  return {
    name_raw: company.nameRaw ?? company.name ?? null,
    name_display: company.name ?? null,
    normalized_name: company.normalizedName ?? null,
    website_url: company.websiteUrl ?? null,
    website_domain: company.websiteDomain ?? null,
  };
}
```

### E.4) `raw_json` Storage Policy

**Per `A_define_ingestion&counters.md` rule 5:** No raw retention in `company_sources`.

**Current `CompanySourceInput`:** Has `raw_json` field.

**Decision:** When upserting `company_sources`, pass `raw_json: null` (or omit). The field exists for future use but should not be populated in M1.

---

## F) Counters Placement Decision

### F.1) Where Should Counters Live?

**Current:** `RunAccumulator` in `runLifecycle.ts` tracks:

- `pages_fetched`
- `offers_fetched`
- `errors_count`

**Missing counters (per `A_define_ingestion&counters.md` rule 8):**

- `offers_upserted` — offers successfully persisted
- `offers_skipped` — offers skipped (with reason)
- `offers_failed` — offers where upsert threw
- `company_sources_failed` — optional

### F.2) Decision: Extend `RunCounters`

**Location:** `src/types/db.ts`

Add new counter fields:

```typescript
type RunCounters = {
  pages_fetched?: number | null;
  offers_fetched?: number | null;
  offers_upserted?: number | null; // NEW
  offers_skipped?: number | null; // NEW
  offers_failed?: number | null; // NEW (different from errors_count)
  errors_count?: number | null; // Fatal errors only
};
```

**Note:** These counters are accumulated in `RunAccumulator` during ingestion, NOT stored in DB (the DB schema for `ingestion_runs` doesn't have these columns yet).

**Future work:** Consider adding columns to `ingestion_runs` table for detailed tracking.

---

## G) Summary of Audit Findings

| Topic                              | Finding                                        | Action for M1.4-C                    |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------ |
| `upsertCompany` contract           | Exists, works, uses COALESCE                   | Document enrich semantics            |
| `upsertCompanySource` contract     | Exists, works, handles conflict                | Ready to use                         |
| Identity evidence                  | `website_domain` OR `normalized_name` required | Add `canIdentifyCompany()` predicate |
| `JobOfferCompany` → `CompanyInput` | Missing                                        | Add converter function               |
| Normalization helpers              | All present in `companyIdentity.ts`            | Ready to use                         |
| `raw_json` in sources              | Field exists but should be null                | Pass `null` per policy               |
| Counters                           | Missing `offers_skipped`, `offers_failed`      | Extend `RunCounters` type            |
| Logging                            | Use `@/logger` exports                         | Do NOT use `console.log`             |

---

## H) Files to Touch in M1.4-C Implementation

1. `src/utils/companyIdentity.ts` — add `canIdentifyCompany()` and `toCompanyInput()`
2. `src/types/db.ts` — extend `RunCounters` with new counter fields
3. `src/ingestion/` — new ingestion flow that uses the above
4. **Tests** — unit tests for new utilities

**Do NOT modify:**

- `src/db/repos/companiesRepo.ts` — contracts are sufficient
- `migrations/` — schema is adequate
