# Audit: Directory Sources Fetch + Generic Ingestion

**Date:** February 11, 2026  
**Auditor:** Technical review of company directory discovery and persistence  
**Scope:** `src/companySources/**`, constants, types, interfaces, DB persistence

---

## Executive Summary

The directory sources system is **compliant** with project layout rules and implements deterministic, bounded company discovery from three Spanish startup directories. All sources conform to the `CompanyDirectorySource` interface, return canonical `CompanyInput[]`, and persist via a single generic ingestion function that writes only to the `companies` table. Network behavior is bounded by constants, deduplication is deterministic (first-seen wins), and error handling follows the log-and-continue pattern. **One minor violation**: `DirectoryPipelineConfig` interface is defined in a logic file instead of `src/types/`. Compilation passes without errors.

---

## Inventory: Sources + Exports + Entrypoints

### Directory Sources (exported from `src/companySources/`)

| Source                     | ID          | Seed URL                                                   | Pattern                                      |
| -------------------------- | ----------- | ---------------------------------------------------------- | -------------------------------------------- |
| `cataloniaDirectorySource` | `CATALONIA` | `https://startupshub.catalonia.com/list-of-startups`       | Single-page extraction                       |
| `madrimasdDirectorySource` | `MADRIMASD` | `https://startups.madrimasd.org/...nuevas-empresas-madrid` | Multi-step pipeline (listing → detail pages) |
| `lanzaderaDirectorySource` | `LANZADERA` | `https://lanzadera.es/proyectos/`                          | Evidence-based (Option A or B)               |

### Interface Contract

**File:** `src/interfaces/companySources/companyDirectorySource.ts`

All sources implement:

```typescript
interface CompanyDirectorySource {
  id: string;
  seedUrl: string;
  fetchCompanies(): Promise<CompanyInput[]>;
}
```

### Output Type

**File:** `src/types/db.ts`

```typescript
type CompanyInput = {
  name_raw?: string | null;
  name_display?: string | null;
  normalized_name?: string | null;
  website_url?: string | null;
  website_domain?: string | null;
};
```

**Identity invariant:** Must have `website_domain` OR `normalized_name` for persistence.

### Ingestion Function

**File:** `src/companySources/ingestDirectorySources.ts`

```typescript
export async function ingestDirectorySources(
  sources: CompanyDirectorySource[],
): Promise<{
  bySource: Record<string, CompanySourceIngestionResult>;
  total: CompanySourceIngestionResult;
}>;
```

### Shared Helpers (reusable extraction logic)

**Location:** `src/companySources/shared/`

- `directoryPipeline.ts` — Multi-step pipeline (listing → detail pages → websites)
- `listingExtraction.ts` — Single-page extraction with evidence detection
- `htmlAnchors.ts` — Regex-based anchor extraction
- `urlFilters.ts` — URL exclusion logic (domains, extensions, length, protocols)

---

## Determinism & Boundedness

| Source        | Max Network Requests           | Caps Applied                                                                            | Recursion/Crawling | Ordering & Dedupe                                               |
| ------------- | ------------------------------ | --------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------- |
| **Catalonia** | 1 (listing only)               | `MAX_COMPANIES_PER_SOURCE` (50)                                                         | ❌ No loops        | First-seen wins; dedupe by `website_domain` → `normalized_name` |
| **Madri+d**   | 1 + N (N ≤ 50)                 | `MAX_DETAIL_PAGES` (50), `MAX_WEBSITES_PER_DETAIL` (1), `MAX_COMPANIES_PER_SOURCE` (50) | ❌ No loops        | First-seen wins; dedupe by `website_domain` → `normalized_name` |
| **Lanzadera** | 1 + N (N ≤ 50, evidence-based) | Same as Madri+d                                                                         | ❌ No loops        | Same as Madri+d                                                 |

### Boundedness Analysis

**Catalonia (single-page extraction):**

- HTTP requests: **1** (seed URL only)
- Result cap: `MAX_COMPANIES_PER_SOURCE` = **50**
- Iteration: anchors extracted from listing HTML, loop exits when 50 companies collected
- No pagination, no crawling

**Madri+d (multi-step pipeline):**

- HTTP requests: **1 + N** where N ≤ `MAX_DETAIL_PAGES` = **50**
- Result cap: `MAX_COMPANIES_PER_SOURCE` = **50**
- Per-detail cap: `MAX_WEBSITES_PER_DETAIL` = **1**
- Iteration: listing → extract detail URLs (capped at 50) → fetch each detail page → extract external links (capped at 1 per detail)
- Total worst-case: **51 requests** (1 listing + 50 detail pages)

**Lanzadera (evidence-based):**

- HTTP requests: **1 + N** where N ∈ {0, 50} depending on evidence
  - If HTML contains external links (Option A): **1 request** (listing only)
  - Otherwise (Option B): **1 + N** requests (same as Madri+d)
- Result cap: `MAX_COMPANIES_PER_SOURCE` = **50**
- Evidence check: `hasExternalWebsiteCandidates()` scans listing HTML for external links
- Branches deterministically to single-page or multi-step pipeline

**Deduplication strategy (all sources):**

1. Deduplicate by `website_domain` (first-seen wins) using `Set<string>`
2. Secondary dedupe by `normalized_name` (prevents same company with different domains)
3. Stable ordering: anchors processed in document order (regex extraction order)

**No recursion detected:**

- ✅ No recursive function calls
- ✅ No dynamic URL discovery beyond 2 levels (listing → detail → external)
- ✅ Detail page URLs validated against patterns/predicates (no blind following)

---

## Identity + Normalization Correctness

### Identity Fields

**Primary identity:** `website_domain` (strongest signal)

- Extracted via: `extractWebsiteDomain(url)`
- Normalization: lowercase, strip leading `www.`, validation (must contain `.`)
- **File:** `src/utils/identity/companyIdentity.ts:63`

**Fallback identity:** `normalized_name`

- Normalized via: `normalizeCompanyName(raw)`
- Normalization: lowercase, remove diacritics, collapse whitespace, strip legal suffixes (s.l., s.a., etc.)
- **File:** `src/utils/identity/companyIdentity.ts:18`

### Persistence Invariant

**Requirement:** `website_domain` **OR** `normalized_name` (at least one must be present)

**Validation locations:**

1. **At source level** (pre-persistence):
   - `ingestDirectorySources.ts:19` — `hasValidIdentity()` checks both fields
   - Companies skipped if neither field present (counted in `skipped` metric)

2. **At DB level** (upsert guard):
   - `src/db/repos/companiesRepo.ts:31` — `upsertCompany()` throws error if neither field present
   - This is a safety check; normal flow should never reach this

**✅ Confirmed:** No code requires **both** fields simultaneously. Identity resolution is OR-based:

- If `website_domain` present → use domain-based identity
- Else if `normalized_name` present → use name-based identity
- Else → skip (per-record failure, logged and counted)

### Normalization Functions

**`extractWebsiteDomain(url: string): string | null`**

- Parse URL using `new URL()` (throws on malformed)
- Extract hostname → lowercase → strip `www.` prefix
- Validate: must contain `.` and be non-empty
- Returns null on failure (does not throw)
- **File:** `src/utils/identity/companyIdentity.ts:63-89`

**`normalizeCompanyName(raw: string): string`**

- Trim → lowercase → remove diacritics (NFD decomposition)
- Collapse whitespace → strip legal suffixes (conservative patterns)
- Returns empty string on null/empty input
- **File:** `src/utils/identity/companyIdentity.ts:18-48`

---

## Persistence Path Audit

### Call Graph

```
ingestDirectorySources(sources)
  └─> for each source:
      └─> source.fetchCompanies() → CompanyInput[]
          └─> for each company:
              └─> hasValidIdentity(company) → skip if false
              └─> upsertCompany(company) → number (company_id)
```

### Database Writes

**Single canonical persistence function:**

- **Function:** `upsertCompany(input: CompanyInput): number`
- **File:** `src/db/repos/companiesRepo.ts:31`
- **Table:** `companies` (only)
- **Method:** INSERT or UPDATE based on identity match

**Identity resolution logic (in order):**

1. If `website_domain` present → query by domain
2. Else if `normalized_name` present → query by name
3. Else → throw error (caller must skip)

**Update behavior:** Enrich existing company with new data, but don't overwrite non-null fields with null (uses `COALESCE`)

### No `company_sources` Usage

**✅ Verified:** Zero references to `company_sources` table in directory sources code

**Grep results:**

```
src/companySources/ingestDirectorySources.ts:7: (comment only)
// "Does NOT write to company_sources (no provider context for directory sources)."
```

**Why:** Directory sources are public listings without provider IDs, so they only populate the global `companies` table. The `company_sources` table is reserved for ATS/job board ingestion where provider context exists.

### Error Handling & Logging

**Per-record failures:**

- Pattern: log + count + continue (no throw, no batch abort)
- Bounded logging: one DEBUG per company, one INFO per source, one INFO total

**Error scenarios:**

1. **Source-level fetch failure** (listing page):
   - Action: log ERROR, return empty result for that source, continue with other sources
   - Location: `ingestDirectorySources.ts:93-99`

2. **Company validation failure** (no identity):
   - Action: log DEBUG, increment `skipped` counter, continue
   - Location: `ingestDirectorySources.ts:111-118`

3. **Company persistence failure** (DB error):
   - Action: log WARN, increment `failed` counter, continue
   - Location: `ingestDirectorySources.ts:132-138`

**Log volume (worst-case for 3 sources, 50 companies each):**

- DEBUG: ~150 (1 per company + context logs)
- INFO: **4 lines** (3 per-source summaries + 1 total summary)
- WARN/ERROR: variable (only on failures)

**✅ Log volume is bounded and deterministic**

---

## Compliance Findings

### ✅ PASS: Interface + Type Separation

- **Interfaces:** `CompanyDirectorySource` lives in `src/interfaces/companySources/`
- **Types:** `CompanyInput`, `CompanySourceIngestionResult` live in `src/types/`
- **No logic-file types detected** except one violation (see below)

### ⚠️ FAIL: Type in Logic File

**Violation:**

- **File:** `src/companySources/shared/directoryPipeline.ts:30`
- **Code:** `export interface DirectoryPipelineConfig { ... }`
- **Rule violation:** Per `docs/project-layout.md`, all public types must live under `src/types/`

**Impact:** Low (only used internally by shared helpers, not exported from module root)

**Recommendation:** Move `DirectoryPipelineConfig` to `src/types/companySources.ts` or create `src/types/directoryPipeline.ts`

### ✅ PASS: Constants Separation

All tunables live in `src/constants/directoryDiscovery.ts`:

- `MAX_COMPANIES_PER_SOURCE` = 50
- `MAX_PAGES_PER_SOURCE` = 3 (unused but defined)
- `MAX_URL_LENGTH` = 2048
- `MAX_DETAIL_PAGES` = 50
- `MAX_WEBSITES_PER_DETAIL` = 1
- `IGNORE_EXTENSIONS` = `[".pdf", ".jpg", ...]`
- `EXCLUDED_DOMAINS` = `["linkedin.com", ...]`
- `DETAIL_PATH_PATTERNS` = `{ MADRIMASD: "...", ... }`

**No magic numbers detected in logic files.**

### ✅ PASS: Determinism + Boundedness

- All loops bounded by constants (no while-true or recursive crawling)
- Network requests capped per tunable configuration
- Output size capped by `MAX_COMPANIES_PER_SOURCE`
- Deduplication deterministic (first-seen wins, stable ordering)

### ✅ PASS: Canonical Persistence

- Single ingestion function: `ingestDirectorySources()`
- Single DB write function: `upsertCompany()`
- No direct SQL in source logic
- No writes to `company_sources` table

### ✅ PASS: Error Handling Policy

- Per-record failures: log + continue (no batch abort)
- Network failures: return empty array (graceful degradation)
- Bounded logging: one INFO per source + one total
- No `console.log` usage (all via `src/logger/`)

### ✅ PASS: Identity Invariants

- `website_domain` OR `normalized_name` required (never both)
- Validation at ingestion level (skip if missing)
- Safety check at DB level (throw if missing)
- Normalization deterministic (lowercase, diacritics, etc.)

### ✅ PASS: Imports

- All imports use `@/...` pattern (no relative imports across modules)
- Types imported from `@/types` or `@/types/db`
- No deep-linking with `./` or `../` outside module boundaries

### ✅ PASS: TypeScript Compilation

**Command run:** `npx tsc --noEmit --project tsconfig.json`  
**Result:** Exit code 0 (no errors)

---

## Architectural Notes

### Extraction Patterns

1. **Single-page extraction (Option A):**
   - Used by: Catalonia (always), Lanzadera (conditionally)
   - Implementation: `extractCompaniesFromListing()` in `shared/listingExtraction.ts`
   - Pros: 1 HTTP request, fast
   - Cons: Only works if external links present in listing

2. **Multi-step pipeline (Option B):**
   - Used by: Madri+d (always), Lanzadera (conditionally)
   - Implementation: `fetchCompaniesViaDetailPages()` in `shared/directoryPipeline.ts`
   - Pros: Handles directories without direct links
   - Cons: N+1 HTTP requests (network-intensive)

3. **Evidence-based branching:**
   - Used by: Lanzadera only
   - Logic: Check for external links in listing → choose Option A or B
   - Provides optimal mix of performance and completeness

### URL Filtering

**Exclusion rules** (applied via `shouldExcludeUrl()`):

- Length > 2048 chars
- File extensions: `.pdf`, `.jpg`, `.png`, `.zip`, `.gif`
- Non-http(s) protocols
- Internal links (same domain as source)
- Social/aggregator domains: `linkedin.com`, `twitter.com`, `facebook.com`, `github.com`, `startupshub.catalonia.com`

**Detail page validation:**

- Madri+d: Path must contain `/emprendedores/empresa/detalle/`
- Lanzadera: Custom predicate (path must start with `/proyectos/` + have additional segment + be same-host)

---

## Code Quality Notes

### File Sizes

| File                        | Lines | Notes                                                |
| --------------------------- | ----- | ---------------------------------------------------- |
| `directoryPipeline.ts`      | 336   | Moderate; main pipeline logic with inline validation |
| `ingestDirectorySources.ts` | 173   | Reasonable; clear ingestion orchestration            |
| `listingExtraction.ts`      | 162   | Reasonable; single-page extraction logic             |
| `cataloniaSource.ts`        | 168   | Reasonable; source-specific parsing                  |
| `lanzaderaSource.ts`        | 145   | Reasonable; evidence-based branching                 |
| `madrimasdSource.ts`        | 71    | Small; thin wrapper over shared pipeline             |

**No files exceed 400 lines.** All well-structured.

### Duplication Analysis

**Pre-refactor state (Task 9):**

- Lanzadera originally ~434 lines with duplicated extraction logic
- Refactor extracted shared helpers (67% code reduction)

**Post-refactor state:**

- Minimal duplication remaining
- Shared helpers provide reusable primitives for all sources
- Source-specific logic appropriately isolated

### Test Coverage

**Note:** Audit did not include test files. Recommend verifying:

- Unit tests for identity normalization (`extractWebsiteDomain`, `normalizeCompanyName`)
- Unit tests for shared helpers (`extractAnchors`, `shouldExcludeUrl`)
- Integration tests for each source (mocked HTTP responses)
- Integration tests for `ingestDirectorySources` (with in-memory DB)

---

## Actionable Follow-ups

### 1. Move `DirectoryPipelineConfig` to types

**Priority:** Medium  
**File:** `src/companySources/shared/directoryPipeline.ts:30`  
**Action:** Move interface to `src/types/companySources.ts` or create `src/types/directoryPipeline.ts`, update imports  
**Reason:** Compliance with project-layout.md rule (no public types in logic files)

### 2. Add explicit validation for `MAX_PAGES_PER_SOURCE`

**Priority:** Low  
**File:** `src/constants/directoryDiscovery.ts:26`  
**Action:** Either use this tunable (implement pagination) or remove it (unused constant)  
**Reason:** Currently defined but never referenced; potential confusion

### 3. Document evidence-based branching in constants

**Priority:** Low  
**File:** `src/constants/directoryDiscovery.ts`  
**Action:** Add comment explaining when/why Lanzadera uses evidence-based strategy  
**Reason:** Improve discoverability of this pattern for future sources

### 4. Add runtime validation for empty source arrays

**Priority:** Low  
**File:** `src/companySources/ingestDirectorySources.ts:52`  
**Action:** Guard against `sources = []` (log warning, return empty result early)  
**Reason:** Defensive programming; avoid silent no-ops

### 5. Consider extracting URL validation to shared utility

**Priority:** Low  
**File:** `src/companySources/lanzadera/lanzaderaSource.ts:30`  
**Action:** Move `isLanzaderaDetailPage()` pattern to shared helper with parameterization  
**Reason:** Could be reused by future sources with similar structural URL matching needs

---

## Summary

**System status:** ✅ **Production-ready with one minor compliance issue**

The directory sources system successfully implements deterministic, bounded company discovery with proper separation of concerns. All sources conform to the interface contract, return canonical types, and persist via a single generic ingestion path. Network behavior is fully bounded by constants, deduplication is stable, and error handling follows the specified log-and-continue pattern.

**Only issue:** `DirectoryPipelineConfig` interface should be moved to `src/types/` per project layout rules (low priority, quick fix).

**Verification:** TypeScript compilation passes without errors.
