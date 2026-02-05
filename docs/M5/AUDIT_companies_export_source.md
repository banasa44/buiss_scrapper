# AUDIT: Companies Export Data Source

**Date:** 2024  
**Author:** Copilot  
**Status:** ✅ Complete

---

## Executive Summary

This audit identifies the database source for companies with aggregation metrics and proposes the missing data access method needed for Google Sheets export.

**Key Findings:**

- ✅ **Table:** `companies` (migration 0003)
- ✅ **Type:** `Company` from `src/types/db.ts`
- ❌ **Missing:** No method exists to list all companies
- 📋 **Proposal:** Add `listAllCompanies()` to `companiesRepo.ts`
- 🎯 **Indexes:** Ordering by `max_score DESC` or `last_strong_at DESC` is optimized

---

## 1. Data Source Identification

### A) Database Table: `companies`

**Migration:** `migrations/0003_company_aggregation_signals.sql`

Adds 9 M4 aggregation signal columns:

- `max_score` (REAL, nullable) - Highest relevance score (0-10)
- `offer_count` (INTEGER, nullable) - Total posting activity
- `unique_offer_count` (INTEGER, nullable) - Canonical offer count
- `strong_offer_count` (INTEGER, nullable) - High-quality offers (score >= 6)
- `avg_strong_score` (REAL, nullable) - Average score of strong offers
- `top_category_id` (TEXT, nullable) - Most prevalent job category
- `top_offer_id` (INTEGER, nullable) - Representative strong offer ID
- `category_max_scores` (TEXT, nullable) - JSON: per-category max scores
- `last_strong_at` (TEXT, nullable) - ISO timestamp of most recent strong offer

**Indexes (query optimization):**

```sql
CREATE INDEX IF NOT EXISTS idx_companies_max_score ON companies(max_score DESC);
CREATE INDEX IF NOT EXISTS idx_companies_last_strong_at ON companies(last_strong_at DESC);
CREATE INDEX IF NOT EXISTS idx_companies_top_offer ON companies(top_offer_id);
```

### B) TypeScript Type: `Company`

**Location:** `src/types/db.ts`

```typescript
export interface Company {
  // Identity (M1)
  id: number;
  name_raw: string | null;
  name_display: string | null;
  normalized_name: string | null;
  website_url: string | null;
  website_domain: string | null;

  // Aggregation signals (M4)
  max_score: number | null;
  offer_count: number | null;
  unique_offer_count: number | null;
  strong_offer_count: number | null;
  avg_strong_score: number | null;
  top_category_id: string | null;
  top_offer_id: number | null;
  category_max_scores: string | null; // JSON-serialized object
  last_strong_at: string | null;

  // Timestamps
  created_at: string;
  updated_at: string;
}
```

**Alignment:** ✅ Type matches migration 0003 schema exactly.

---

## 2. Existing Repository Methods

### Current `companiesRepo.ts` API

| Method                                      | Return Type              | Query Pattern                      |
| ------------------------------------------- | ------------------------ | ---------------------------------- |
| `upsertCompany(input)`                      | `number` (company ID)    | INSERT/UPDATE by domain/name       |
| `upsertCompanySource(input)`                | `number` (source ID)     | INSERT/UPDATE company_sources      |
| `getCompanyById(id)`                        | `Company \| undefined`   | `SELECT * WHERE id = ?`            |
| `getCompanySourceById(id)`                  | `CompanySource \| undef` | `SELECT * WHERE id = ?`            |
| `getCompanySourcesByCompanyId(companyId)`   | `CompanySource[]`        | `SELECT * WHERE company_id = ?`    |
| `updateCompanyAggregation(companyId, data)` | `Company`                | Dynamic UPDATE with partial fields |

**Critical Gap:** ❌ **No method to list all companies.**

All existing queries require a known `companyId` parameter. No "SELECT \* FROM companies" or list/batch query exists.

---

## 3. Aggregation Orchestration Context

### How Companies Get Aggregated (M4)

**Flow:** Offers ingested → Companies extracted → Aggregation triggered at end-of-run

**Code Path:**

1. `runOfferBatchIngestion()` - Processes offers, tracks affected companies
2. `aggregateCompaniesAndPersist(companyIds[])` - Batch aggregates affected companies
3. `aggregateCompanyAndPersist(companyId)` - Single-company orchestration:
   - Fetch offers: `listCompanyOffersForAggregation(companyId)`
   - Map rows: `mapCompanyOfferRows(rows)`
   - Compute signals: `aggregateCompany(offers)`
   - Persist: `updateCompanyAggregation(companyId, data)`

**Key Insight:** Aggregation processes **known company IDs** from ingestion context, not "all companies in DB".

---

## 4. What's Missing for Export

### Requirements for Sheets Export

To export companies to Google Sheets, we need:

1. ✅ **Schema definition** - BUILD-3B1 complete (10 columns)
2. ✅ **Row mapper** - BUILD-4A complete (`mapCompanyToSheetRow`)
3. ✅ **Module wiring** - BUILD-4B complete (barrel exports)
4. ❌ **Data access method** - **MISSING**: How to fetch all companies

### Gap Analysis

**Problem:** No repo method to "list all companies with aggregation signals".

**Current workaround (not scalable):**

```typescript
// This works but is too low-level for application code
const db = getDb();
const companies = db.prepare("SELECT * FROM companies").all() as Company[];
```

**Why this matters:**

- Raw `db.prepare()` bypasses repo abstraction
- No pagination support
- No ordering strategy
- No filtering (e.g., "only companies with max_score != null")

---

## 5. Proposed Solution

### Add `listAllCompanies()` to `companiesRepo.ts`

**Minimal Implementation:**

```typescript
/**
 * List all companies with optional ordering and pagination
 *
 * Default ordering: max_score DESC NULLS LAST (highest quality first)
 * This leverages idx_companies_max_score for efficient sorting.
 *
 * @param options - Optional pagination and ordering
 * @returns Array of companies
 */
export function listAllCompanies(options?: {
  orderBy?: "max_score" | "last_strong_at" | "id";
  limit?: number;
  offset?: number;
}): Company[] {
  const db = getDb();

  // Default: order by max_score DESC (quality-first)
  const orderBy = options?.orderBy ?? "max_score";
  const orderDirection = orderBy === "id" ? "ASC" : "DESC";

  let sql = `SELECT * FROM companies ORDER BY ${orderBy} ${orderDirection}`;

  // Handle NULLS LAST for nullable columns
  if (orderBy !== "id") {
    sql += ` NULLS LAST`;
  }

  // Pagination
  if (options?.limit !== undefined) {
    sql += ` LIMIT ${options.limit}`;
  }
  if (options?.offset !== undefined) {
    sql += ` OFFSET ${options.offset}`;
  }

  return db.prepare(sql).all() as Company[];
}
```

**Variants to Consider:**

1. **Filter by aggregation status:**

   ```typescript
   export function listAggregatedCompanies(): Company[] {
     // Only companies with computed signals
     return db
       .prepare(
         "SELECT * FROM companies WHERE max_score IS NOT NULL ORDER BY max_score DESC",
       )
       .all() as Company[];
   }
   ```

2. **Top N by quality:**

   ```typescript
   export function listTopCompanies(limit: number): Company[] {
     return listAllCompanies({ orderBy: "max_score", limit });
   }
   ```

3. **Active companies (recent strong offers):**
   ```typescript
   export function listActiveCompanies(sinceDays: number): Company[] {
     const db = getDb();
     return db
       .prepare(
         `
       SELECT * FROM companies
       WHERE last_strong_at >= datetime('now', '-${sinceDays} days')
       ORDER BY last_strong_at DESC
     `,
       )
       .all() as Company[];
   }
   ```

### Recommended Approach for M5

**For BUILD-5 (initial export):**

- Add minimal `listAllCompanies()` with default ordering
- Use `orderBy: "max_score"` (highest quality first)
- No filtering initially (export all companies)
- Pagination optional (depends on DB size)

**Rationale:**

- ✅ Consistent with repo pattern (all queries in companiesRepo.ts)
- ✅ Uses existing index (idx_companies_max_score)
- ✅ Extensible (add filters/pagination later if needed)
- ✅ Testable in isolation (unit test with fixture data)

---

## 6. Export Strategy Implications

### Ordering Recommendation

**Default: `ORDER BY max_score DESC NULLS LAST`**

Rationale:

- Highest-quality companies appear first in sheet
- NULLS LAST ensures unaggregated companies at bottom
- Index `idx_companies_max_score` optimizes query
- Aligns with client workflow (review top companies first)

**Alternative orderings:**

- `last_strong_at DESC` - Most recently active companies first
- `id ASC` - Chronological order (creation time proxy)

### Pagination Consideration

**Current DB Size:** Unknown (check `scripts/check-companies.ts` output)

**Decision Point:**

- If DB < 1000 companies → No pagination needed (fetch all)
- If DB > 1000 companies → Add `limit/offset` for memory efficiency
- If DB > 10,000 companies → Consider batch export with progress tracking

**Proposal:** Start without pagination, add if performance issues arise.

---

## 7. Integration with Existing Code

### How Export Will Use New Method

**BUILD-5 (Append-only export):**

```typescript
// Pseudocode for export orchestration
export async function exportCompaniesToSheet(
  client: GoogleSheetsClient,
  catalog: CatalogRuntime,
): Promise<ExportResult> {
  // 1. Fetch all companies from DB
  const companies = listAllCompanies({ orderBy: "max_score" });

  // 2. Map to sheet rows (BUILD-4A mapper)
  const rows = companies.map((company) =>
    mapCompanyToSheetRow(company, catalog),
  );

  // 3. Append to sheet (Google Sheets API)
  const result = await client.appendRows(COMPANY_SHEET_NAME, rows);

  return result;
}
```

**BUILD-6 (Upsert/update logic):**

```typescript
// Pseudocode for incremental update
export async function syncCompaniesToSheet(
  client: GoogleSheetsClient,
  catalog: CatalogRuntime,
): Promise<SyncResult> {
  // 1. Read existing sheet state (BUILD-2 reader)
  const sheetIndex = await readCompanySheet(client);

  // 2. Fetch all companies from DB
  const companies = listAllCompanies({ orderBy: "max_score" });

  // 3. Diff: new companies vs existing rows
  const newCompanies = companies.filter((c) => !sheetIndex.index.has(c.id));
  const existingCompanies = companies.filter((c) => sheetIndex.index.has(c.id));

  // 4. Append new companies
  // 5. Update existing rows (metric columns only)
  // ...
}
```

---

## 8. Testing Considerations

### Unit Tests (companiesRepo.test.ts)

**New method coverage:**

```typescript
describe("listAllCompanies", () => {
  test("returns all companies ordered by max_score DESC", () => {
    // Insert fixture companies with known scores
    // Query with listAllCompanies()
    // Assert order and completeness
  });

  test("respects limit and offset for pagination", () => {
    // Insert 20 companies
    // Query with { limit: 5, offset: 10 }
    // Assert correct page returned
  });

  test("handles empty companies table", () => {
    // Query empty DB
    // Assert returns empty array
  });

  test("places null max_scores at end with NULLS LAST", () => {
    // Insert companies with mix of null and non-null scores
    // Assert nulls appear last
  });
});
```

### Integration Test (export workflow)

```typescript
test("export workflow: DB → mapper → sheet format", () => {
  // 1. Seed DB with fixture companies (aggregated)
  // 2. Call listAllCompanies()
  // 3. Map rows with mapCompanyToSheetRow()
  // 4. Assert array structure matches sheet schema
});
```

---

## 9. Summary & Next Steps

### Findings

| Aspect                | Status | Details                                      |
| --------------------- | ------ | -------------------------------------------- |
| DB Table              | ✅     | `companies` table with 9 aggregation columns |
| Type Definition       | ✅     | `Company` in `src/types/db.ts` (aligned)     |
| Indexes               | ✅     | `max_score` and `last_strong_at` indexed     |
| Existing Repo Methods | ✅     | Single-company queries only                  |
| **List Method**       | ❌     | **MISSING** - must implement                 |
| Aggregation Flow      | ✅     | M4 orchestration writes to `companies` table |
| Mapper (BUILD-4A)     | ✅     | `mapCompanyToSheetRow()` ready               |

### Recommended Actions

**Immediate (for BUILD-5):**

1. ✅ Add `listAllCompanies(options?)` to `src/db/repos/companiesRepo.ts`
2. ✅ Default ordering: `max_score DESC NULLS LAST`
3. ✅ Export from `src/db/index.ts` (barrel)
4. ✅ Write unit tests (companiesRepo.test.ts)
5. ✅ Update repo documentation (`src/db/README.md`)

**Optional (future optimization):**

- Add `listAggregatedCompanies()` (filter `max_score IS NOT NULL`)
- Add `listTopCompanies(limit)` helper
- Add pagination if DB grows large (> 1000 companies)

### Decision Matrix

| Scenario                      | Use This Method                              | Notes                          |
| ----------------------------- | -------------------------------------------- | ------------------------------ |
| Export all companies to sheet | `listAllCompanies({ orderBy: "max_score" })` | Default, quality-first         |
| Debug aggregation coverage    | `listAggregatedCompanies()`                  | Only companies with signals    |
| Preview top performers        | `listTopCompanies(10)`                       | Sample for client review       |
| Active companies report       | `listActiveCompanies(30)`                    | Companies with recent activity |

---

## Conclusion

**The `companies` table is the correct source of truth** for aggregated company metrics. However, **no repo method exists to list all companies** for export.

**Proposed solution:** Add `listAllCompanies()` to `companiesRepo.ts` with:

- Default ordering: `max_score DESC NULLS LAST` (leverages index)
- Optional pagination (limit/offset)
- Type-safe return: `Company[]`

This unblocks BUILD-5 (export implementation) while maintaining repo abstraction and query optimization.

**Status:** Ready to proceed with `listAllCompanies()` implementation.
