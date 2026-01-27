# M1.4-D: Offer Persistence Decisions

## Decision 1: Dedupe Key

**Chosen:** `(provider, provider_offer_id)` — composite key

### Rationale

- The SQLite schema already enforces `CONSTRAINT uq_offer_provider_id UNIQUE (provider, provider_offer_id)`
- The repo uses `ON CONFLICT(provider, provider_offer_id)` for upserts
- This is **safer** than `provider_offer_id` alone: prevents cross-provider ID collisions (e.g., InfoJobs offer "123" won't overwrite LinkedIn offer "123")
- The original spec wording in `A_define_ingestion&counters.md` rule 1 is misleading; the DB is the source of truth
- No migration or schema change required

### Consequences for M1.4-D

- Always pass both `provider` and `provider_offer_id` to `upsertOffer()`
- Both fields are already required in `OfferInput` type
- Update `A_define_ingestion&counters.md` wording to match DB constraint (documentation fix, not code)

---

## Decision 2: raw_json Policy for Offers

**Chosen:** `raw_json = null` for M1 (no raw retention)

### Rationale

- Keeping it simple for MVP — raw payloads add storage overhead without clear M1 use case
- The original spec rule 5 describes fill-only semantics, but implementing conditional logic adds complexity
- Raw JSON is useful for debugging/auditing, but not critical for ingestion correctness
- We can add raw retention in a future milestone if needed
- Aligns with `company_sources` policy (no raw retention)

### Consequences for M1.4-D

- Always pass `raw_json: null` when calling `upsertOffer()`
- Do NOT implement fill-only conditional logic in M1
- No changes to repo or schema needed
- Update `A_define_ingestion&counters.md` rule 5 to reflect simplified policy (documentation fix)

---

## Summary

| Decision        | Value                           | Source of Truth                       |
| --------------- | ------------------------------- | ------------------------------------- |
| Dedupe key      | `(provider, provider_offer_id)` | `migrations/0001_init.sql` constraint |
| raw_json policy | Always `null` in M1             | This document                         |

---

## Future

**TODO:** Revisit raw_json retention policy in a future milestone if:

- Debugging requires inspecting original provider payloads
- Auditing/compliance requires storing raw data
- Data reconciliation needs arise

When revisiting, consider:

- Fill-only vs overwrite semantics
- Storage overhead implications
- Whether to apply to both `offers.raw_json` and `company_sources.raw_json`

---

## Deferred

**M1.4-E (STORE_RAW_JSON flag):** Originally planned as an optional feature to conditionally store raw provider payloads. **Status: Deferred to future milestone.**

**Rationale for deferral:**

- M1 focus is on core ingestion correctness, not debugging features
- Raw storage adds complexity without immediate MVP value
- Current `raw_json = null` policy keeps implementation simple and predictable
- Can be reconsidered once core pipeline is stable and actual debugging needs are identified
