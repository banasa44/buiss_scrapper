# M1.4-C: Company Persistence Semantics

## Enrich vs Overwrite

The `companiesRepo.upsertCompany()` function uses **COALESCE (enrich) semantics**:

- Existing non-null values in the database are preserved
- Incoming values only fill in gaps (null columns)
- No existing data is overwritten with null

This differs from the "overwrite-based" rule specified in `A_define_ingestion&counters.md` (rule 2) for offers.

## Why this is intentional for companies

Companies accumulate identity evidence over multiple ingestion runs:

- Run 1 may provide `normalized_name` only (from list endpoint)
- Run 2 may provide `website_domain` (from detail endpoint)
- Both pieces of evidence should be retained

Overwrite semantics would cause data loss when a subsequent run has less complete data.

## What this means in practice

| Scenario                                | Behavior                        |
| --------------------------------------- | ------------------------------- |
| New company (no match)                  | INSERT with all provided fields |
| Existing company, incoming has new data | UPDATE fills gaps only          |
| Existing company, incoming has nulls    | Existing data preserved         |

## Decision

**Accepted.** The enrich semantics for companies is correct and intentional.
Offers may follow different (overwrite) semantics when implemented in M1.4-D.
