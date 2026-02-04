# AUDIT REPORT B — "Invisible Debt" (Unrecorded Follow-ups)

**Date:** February 4, 2026  
**Auditor:** Senior Engineer (Technical Debt Review)  
**Scope:** Identify discussed/decided features not captured as TODOs or milestones

---

## Executive Summary

This audit identifies implicit follow-up work mentioned in design docs but not explicitly tracked as TODOs, milestone tasks, or code comments. These represent "invisible technical debt" that could be forgotten without proper tracking.

**Overall Assessment:** Moderate invisible debt. Most deferred work is documented in decision docs, but lacks concrete tracking mechanisms (TODO comments, milestone entries, or implementation notes).

---

## Identified Follow-ups by Theme

### Theme 1: Repost Detection Performance & Scalability

#### 1.1 Candidate Filtering by Recency Window

**Status:** NOT_RECORDED

**Source:** `docs/M4/repost_decisions.md:133` (section 3)

> "Typically within a reasonable recency window (handled at query level)"

**Current Implementation:** `src/db/repos/offersRepo.ts:listCanonicalOffersForRepost()`

- Fetches ALL canonical offers for a company with no time-based filtering
- No limit on candidate count

**Risk:** Performance degradation for companies with hundreds of historical offers.

**Recommendation:**

- Add TODO in `offersRepo.ts:listCanonicalOffersForRepost()` noting future recency filtering
- Document in `repost_decisions.md` section 8 as explicit future enhancement
- Add milestone note in M6 (operationalization) to revisit performance tuning

---

#### 1.2 content_fingerprint Pre-filtering

**Status:** TODO_EXISTS (partially)

**Source:**

- `docs/M4/repost_decisions.md:147` (section 8: "Future extensions")
- Migration: `migrations/0004_offer_canonicalization.sql` includes field + index

**Current State:**

- ✅ Schema field exists (`content_fingerprint TEXT`)
- ✅ Index created (`idx_offers_fingerprint_company`)
- ❌ Field is NEVER populated during ingestion
- ❌ Function `findCanonicalOffersByFingerprint()` exists but UNUSED

**Gap:** Schema is "ready" but completely dead code. No plan for when/how to populate.

**Recommendation:**

- Add TODO in `offerPersistence.ts` noting fingerprint population is deferred
- Document in `repost_decisions.md` that v1 intentionally skips this optimization
- Add note to milestone tracking that this is "M4-DEFERRED" not just "future enhancement"

---

#### 1.3 Configurable Thresholds per Provider

**Status:** NOT_RECORDED

**Source:** `docs/M4/repost_decisions.md:151`

> "Configurable thresholds per provider"

**Current Implementation:** `src/constants/repost.ts`

- Single hardcoded `DESC_SIM_THRESHOLD = 0.9`
- No provider-specific logic

**Risk:** Low (single provider for now), but InfoJobs-specific tuning might be needed after production data.

**Recommendation:**

- Add TODO in `constants/repost.ts` noting future provider-specific thresholds
- Cross-reference with `constants/scoring.ts` TODOs about calibration

---

#### 1.4 Lower Threshold with Title Hint (0.85)

**Status:** TODO_EXISTS (in doc only)

**Source:** `docs/M4/repost_decisions.md:59-67`

> "DESC_SIM_THRESHOLD_WITH_TITLE_HINT = 0.85"
> "For the initial implementation, only the 0.90 threshold will be used"

**Current Implementation:** Not implemented, only 0.90 threshold used.

**Audit Finding:** This is properly documented as deferred. Recommendation: add constant placeholder with TODO comment.

**Recommendation:**

- Add commented-out constant in `constants/repost.ts`:
  ```typescript
  // TODO: Implement title-hint lower threshold when fuzzy title matching is added
  // export const DESC_SIM_THRESHOLD_WITH_TITLE_HINT = 0.85;
  ```

---

### Theme 2: Data Model Ambiguity

#### 2.1 canonical_offer_id Strategy Documentation

**Status:** NOT_RECORDED

**Source:** Implicit from implementation audit

**Current State:**

- `canonical_offer_id` field exists in schema (migration 0004)
- `markOfferAsDuplicate()` function exists but is NEVER called in production code
- Only used in test/verification script (`src/db/verify.ts`)
- **Decision:** v1 never inserts duplicate rows; only bumps `repost_count`

**Gap:** Schema suggests "duplicate rows will reference canonical" but implementation chose "never create duplicate rows." This divergence is not documented anywhere.

**Risk:** Future developers might assume duplicate row strategy and write code accordingly.

**Recommendation:**

- Add comment in `migrations/0004_offer_canonicalization.sql` explaining the two strategies:
  ```sql
  -- STRATEGY NOTE: Current implementation (v1) uses repost_count-only strategy.
  -- canonical_offer_id is reserved for potential future batch canonicalization.
  -- See docs/M4/repost_decisions.md for design rationale.
  ```
- Add TODO in `offersRepo.ts:markOfferAsDuplicate()`:
  ```typescript
  // TODO: This function is currently unused in production ingestion.
  // It exists for potential future batch retroactive canonicalization.
  // Current strategy: duplicates never create rows; only bump repost_count.
  ```

---

#### 2.2 lastProviderOfferRef Traceability

**Status:** NOT_RECORDED

**Source:** `docs/M4/03_define_repost_detection.md:72`

> "Optionally store `lastProviderOfferRef` (for traceability)"

**Current Implementation:** Not implemented. No field in schema, no tracking.

**Risk:** Low visibility into which specific provider offer triggered repost bump.

**Recommendation:**

- Add note in `repost_decisions.md` section 4 that traceability is deferred
- If needed for debugging, add to M6 (operationalization) as optional logging enhancement

---

### Theme 3: Observability & Telemetry

#### 3.1 Repost Detection Metrics

**Status:** NOT_RECORDED

**Current State:**

- Repost duplicates are counted in ingestion (`ingestOffers.ts:duplicates`)
- Counter tracked in run accumulator (`offers_duplicates`)
- ✅ Logged in summary: `logger.info("Offer batch ingestion complete", { duplicates })`
- ❌ Not persisted to runs table (no run-level duplicate counter in schema)

**Gap:** No historical tracking of duplicate detection rates per run.

**Recommendation:**

- Add TODO in `ingestion/runLifecycle.ts` to add `offers_duplicates` to run counters
- Note in M6 (operationalization) milestone: "Add duplicate detection rate to run telemetry"

---

#### 3.2 Repost Detection Decision Breakdown

**Status:** NOT_RECORDED

**Current State:**

- `DuplicateDecision` includes `reason` field (`exact_title` vs `desc_similarity`)
- Logged per duplicate: `logger.info("Repost duplicate detected", { detectionReason })`
- ❌ No aggregated metrics on detection reason distribution

**Risk:** Can't measure effectiveness of exact-title fast-path vs description similarity.

**Recommendation:**

- Add TODO in `offerPersistence.ts:persistOffer()` noting future telemetry:
  ```typescript
  // TODO: Track detection reason distribution (exact_title vs desc_similarity)
  // for observability and threshold tuning
  ```

---

#### 3.3 Similarity Score Distribution

**Status:** NOT_RECORDED

**Current State:**

- `similarity` value computed and logged for `desc_similarity` matches
- ❌ Not persisted, only logged
- ❌ No analysis of near-misses (scores just below 0.90 threshold)

**Risk:** Can't calibrate threshold or measure false negative rate.

**Recommendation:**

- Add note in `repost_decisions.md` section 8 about threshold calibration telemetry
- Mark as "M6-OBSERVABILITY" enhancement

---

### Theme 4: Backfill & Migration Considerations

#### 4.1 Retroactive Canonicalization

**Status:** TODO_EXISTS (implicitly)

**Source:**

- Audit A finding: `markOfferAsDuplicate()` exists for "batch retroactive canonicalization"
- No doc or milestone mentioning this use case

**Current State:**

- Function signature suggests: insert duplicate row pointing to canonical
- Would be used to convert historical "normal" offers into duplicate references
- No script, no plan, no documentation

**Risk:** If needed (e.g., after provider change or threshold tuning), no clear path to execute.

**Recommendation:**

- Create doc: `docs/M4/RETROACTIVE_CANONICALIZATION_STRATEGY.md` outlining:
  - When retroactive canonicalization would be needed
  - How to use `markOfferAsDuplicate()` safely
  - Migration vs live-traffic considerations
- Add to milestone: "M6.5 (optional) - Retroactive canonicalization tooling"

---

#### 4.2 Repost Count Backfill

**Status:** NOT_RECORDED

**Current State:**

- `repost_count` only increments during ingestion
- Historical offers before M4 will have `repost_count = 0` forever
- No mention of backfill strategy

**Risk:** Company metrics will be biased toward recently ingested offers.

**Recommendation:**

- Add note in `repost_decisions.md` section 4:

  ```markdown
  ## Backfill Considerations

  Historical offers ingested before repost detection (pre-M4) will have:

  - `repost_count = 0` (never incremented retroactively)
  - `last_seen_at = NULL` or ingestion timestamp

  If accurate historical activity-weighted counts are needed:

  - Re-run ingestion with empty DB, OR
  - Implement batch similarity scan (compute-intensive, not prioritized for v1)
  ```

---

### Theme 5: Product/UX Export Implications

#### 5.1 Duplicate Visibility in Exports

**Status:** NOT_RECORDED

**Source:** Implicit from schema design

**Current State:**

- Duplicates never create offer rows (v1 strategy)
- CSV/Sheets exports will show only canonical offers
- No indication that "this offer was seen 5 times" in export

**Gap:** Sales might want to see repost activity as signal of urgency/demand.

**Recommendation:**

- Add note in M5 (Sheets export) milestone:
  - "Export should expose `repost_count` to indicate posting frequency"
  - "Consider 'Last Seen' column to show recency"
- Mark as M5.1-EXPORT-FIELDS definition task

---

#### 5.2 Canonical vs Duplicate Transparency

**Status:** NOT_RECORDED

**Current State:**

- Only canonical offers visible in aggregation
- No debug/admin view to see which provider_offer_ids were merged
- `lastProviderOfferRef` not implemented (see 2.2)

**Risk:** Debugging requires manual DB queries; no traceability UI.

**Recommendation:**

- Add to M6 (operationalization) or M7 (convenience layer):
  - "Debug script to show repost history for a canonical offer"
  - Could use DB query: `SELECT provider, provider_offer_id, last_seen_at FROM offers WHERE canonical_offer_id = ?` (if strategy changes to row-per-duplicate)
  - For current strategy: add logging context to track

---

### Theme 6: Future Enhancement Hooks (Properly Documented)

These are mentioned in docs but properly marked as deferred. Including for completeness:

#### 6.1 Fuzzy Title Matching

**Status:** TODO_EXISTS (in doc)

**Source:** `docs/M4/repost_decisions.md:149`

**Assessment:** ✅ Properly documented as out of scope for v1.

---

#### 6.2 Advanced Similarity Metrics

**Status:** TODO_EXISTS (in doc)

**Source:** `docs/M4/repost_decisions.md:153`

> "More advanced similarity metrics (n-grams, TF-IDF, etc.)"

**Assessment:** ✅ Properly documented as future enhancement.

---

#### 6.3 Raw JSON Retention Flag

**Status:** TODO_EXISTS

**Source:** `docs/ordered-milestones.md:22`

> "M1.4-E (optional raw_json flag) has been deferred to a future milestone"

**Assessment:** ✅ Properly documented. Also referenced in `docs/M1/subtasks_task4_ingestion&dedupe/M1.4/D_offer_persistence_decisions.md:71`

---

## Summary Table

| Follow-up                             | Theme         | Status                 | Priority | Recommended Action                       |
| ------------------------------------- | ------------- | ---------------------- | -------- | ---------------------------------------- |
| **Candidate recency filtering**       | Performance   | NOT_RECORDED           | HIGH     | Add TODO in `offersRepo.ts` + doc note   |
| **content_fingerprint population**    | Performance   | TODO_EXISTS (partial)  | MEDIUM   | Document v1 intentionally skips this     |
| **Provider-specific thresholds**      | Performance   | NOT_RECORDED           | LOW      | Add TODO in `constants/repost.ts`        |
| **Title-hint lower threshold (0.85)** | Performance   | TODO_EXISTS (doc)      | LOW      | Add commented constant with TODO         |
| **canonical_offer_id strategy docs**  | Data Model    | NOT_RECORDED           | HIGH     | Add migration comment + function TODO    |
| **lastProviderOfferRef tracking**     | Data Model    | NOT_RECORDED           | LOW      | Add doc note about deferred traceability |
| **Run-level duplicate counters**      | Observability | NOT_RECORDED           | MEDIUM   | Add `offers_duplicates` to run schema    |
| **Detection reason metrics**          | Observability | NOT_RECORDED           | LOW      | Add TODO for telemetry                   |
| **Similarity score distribution**     | Observability | NOT_RECORDED           | LOW      | Note in M6 observability section         |
| **Retroactive canonicalization**      | Backfill      | TODO_EXISTS (implicit) | MEDIUM   | Create strategy doc                      |
| **Repost count backfill**             | Backfill      | NOT_RECORDED           | LOW      | Document backfill considerations         |
| **Repost count in exports**           | Product/UX    | NOT_RECORDED           | MEDIUM   | Add to M5 export fields definition       |
| **Duplicate traceability UI**         | Product/UX    | NOT_RECORDED           | LOW      | Add to M6/M7 debug tooling               |

---

## Top 5 Items Most Likely to Be Forgotten

### 1. canonical_offer_id Strategy Divergence Documentation

**Why Critical:** Schema suggests one strategy, code implements another. Future developers will be confused.

**Where to Record:**

- Add comment in `migrations/0004_offer_canonicalization.sql`
- Add TODO in `offersRepo.ts:markOfferAsDuplicate()`
- Update `repost_decisions.md` section 4 to explicitly state "v1: never create duplicate rows"

---

### 2. Candidate Recency Filtering Performance

**Why Critical:** Will cause real performance issues when companies accumulate 100+ offers.

**Where to Record:**

- Add TODO comment in `offersRepo.ts:listCanonicalOffersForRepost()`:
  ```typescript
  // TODO: Add recency window filtering (e.g., last 90 days) to limit candidates
  // for companies with large offer history. See repost_decisions.md section 3.
  ```
- Add milestone note: "M6.2 - Performance: Add repost candidate recency filtering"

---

### 3. content_fingerprint Dead Code

**Why Critical:** Schema + index created, function exists, but completely unused. Wasted DB resources.

**Where to Record:**

- Add TODO in `offerPersistence.ts:buildOfferInput()`:
  ```typescript
  // TODO: content_fingerprint intentionally left null in v1 (M4-DEFERRED)
  // See repost_decisions.md section 8 for future pre-filtering enhancement
  ```
- Update `repost_decisions.md` section 8 to state: "v1 implementation: field exists but not populated"

---

### 4. Repost Detection Telemetry Gap

**Why Critical:** Can't measure detection effectiveness or tune thresholds without metrics.

**Where to Record:**

- Add to M6 milestone: "Add repost detection telemetry (reason distribution, similarity scores)"
- Add TODO in `offerPersistence.ts` near logging call

---

### 5. Export Field: Repost Count Visibility

**Why Critical:** Sales teams won't see repost activity in Sheets export, losing valuable urgency signal.

**Where to Record:**

- Add to M5 milestone: "M5.2 - Define export fields including repost_count and last_seen_at"
- Add TODO in export planning doc (when created): "Include repost_count in company export"

---

## Recommendations

### Immediate Actions (High Priority)

1. **Document canonical_offer_id strategy divergence** (1-2 hours)
   - Update migration comment
   - Add function TODO
   - Update repost_decisions.md

2. **Add performance TODOs** (30 minutes)
   - Candidate recency filtering note
   - content_fingerprint dead code note

3. **Create M6 observability section** (1 hour)
   - List deferred telemetry items
   - Reference from repost_decisions.md

### Medium Priority

4. **Create retroactive canonicalization strategy doc** (2-3 hours)
   - Document when/why it would be needed
   - Outline safe execution approach
   - Add to milestone as optional M6.5

5. **Update M5 milestone with export fields** (30 minutes)
   - Add repost_count and last_seen_at to export spec
   - Note UX implications

### Low Priority (Can Wait)

6. **Add provider-specific threshold TODOs** (15 minutes)
7. **Document backfill considerations** (30 minutes)
8. **Add similarity distribution telemetry note** (15 minutes)

---

## Conclusion

**Total Invisible Debt:** 13 follow-up items, of which:

- 8 are NOT_RECORDED (62%)
- 3 are TODO_EXISTS in docs only (23%)
- 2 are TODO_EXISTS implicitly (15%)

**Risk Level:** MEDIUM

The most critical gaps are:

1. Data model strategy documentation (canonical_offer_id)
2. Performance considerations (candidate filtering)
3. Observability/telemetry for tuning

Most deferred enhancements are properly documented, but lack concrete tracking (TODO comments, milestone entries). Immediate action on top 5 items would significantly reduce risk of forgotten work.
