# AUDIT REPORT C — Documentation Hygiene & Single Source of Truth

**Date:** February 4, 2026  
**Auditor:** Senior Engineer (Documentation Review)  
**Scope:** Consistency and clarity of repost/duplicate detection documentation

---

## Executive Summary

**Status:** GOOD with **2 Critical Gaps**

The project has two primary documents for repost detection:

1. **`docs/M4/repost_decisions.md`** — Final design decisions (authoritative)
2. **`docs/M4/03_define_repost_detection.md`** — Original design exploration (less detailed)

Overall documentation is clear and consistent, but has two critical gaps that could cause confusion:

1. **No explicit statement** that v1 never creates duplicate rows (repost_count-only strategy)
2. **Missing last_seen_at semantics** in decision docs

---

## What's Clear and Correct

### ✅ 1. Primary Source of Truth is Well-Defined

**`docs/M4/repost_decisions.md`** is clearly marked as authoritative:

- Header: "Final Design Decisions"
- Footer: "These rules are the authoritative definition for Task 1 implementation"
- Explicitly states it "refines and clarifies" the original `03_define_repost_detection.md`

**Finding:** Clear hierarchy. No ambiguity about which doc to trust.

---

### ✅ 2. Detection Algorithm Fully Specified

**Exact Title Match (Fast-Path):**

- `repost_decisions.md:19`: "If titles match exactly → we consider it a repost immediately and DO NOT compare descriptions"
- ✅ Clear and unambiguous

**Description Similarity:**

- `repost_decisions.md:38-48`: Multiset token overlap formula explicitly documented
- `repost_decisions.md:46`: Formula shown: `similarity = overlap / max(tokenCount(old), tokenCount(new))`
- ✅ Correct metric specified (multiset, not set)

**Thresholds:**

- `repost_decisions.md:58`: `DESC_SIM_THRESHOLD = 0.90` clearly stated
- `repost_decisions.md:64`: Lower threshold (0.85) documented as "future enhancement"
- ✅ Clear current vs future distinction

---

### ✅ 3. Tokenization Consistency Documented

**`repost_decisions.md:118-122`:**

> "All text processing for repost detection must reuse the existing system normalization:
>
> - normalizeToTokens() is used for both title and description
> - No special or separate tokenization logic is introduced
> - This guarantees consistency with M3 matching logic."

**Finding:** ✅ Clear and correct. Cross-references M3 implementation.

---

### ✅ 4. Required Fields Clearly Stated

**`repost_decisions.md:104-112`:**

> "An incoming offer is eligible for repost detection only if:
>
> - title exists and is non-empty
> - description exists and is non-empty
>
> If either is missing:
>
> - Repost detection is skipped
> - The offer is treated as a normal new offer"

**Finding:** ✅ Unambiguous behavior for missing data.

---

### ✅ 5. Aggregation Impact Documented

**`repost_decisions.md:94-96`:**

> "When a repost is detected:
>
> - NO new offer row is created
> - Instead:
>   - Increment repost_count on the canonical offer
>   - Update last_seen_at of the canonical offer
> - No scoring or matching is executed for the repost"

**Cross-reference consistency:**

- `03_define_repost_detection.md:70`: "repostCount += 1"
- `03_define_repost_detection.md:82-91`: Activity-weighted counts explained
- ✅ Consistent across both docs

---

### ✅ 6. Scope Clearly Defined

**`repost_decisions.md:78-82`:**

> "Repost detection is performed only:
>
> - Within the same company identity
> - Against existing canonical offers only
> - Typically within a reasonable recency window (handled at query level)"

**Note:** "Recency window" is mentioned but not implemented in v1 (see Audit B: Invisible Debt).

**Finding:** ✅ Scope is clear, though recency window is aspirational.

---

## What's Ambiguous or Conflicting

### ❌ 1. CRITICAL: "No Duplicate Rows" Policy Not Explicit

**Problem:** The decision docs explain what happens when a repost is detected (increment repost_count), but **never explicitly state** that v1 NEVER creates duplicate offer rows.

**Evidence of Ambiguity:**

**Schema suggests row-per-duplicate strategy:**

- `migrations/0004_offer_canonicalization.sql:5-6`:
  ```sql
  -- Canonical offers have canonical_offer_id = NULL and track repost activity.
  -- Duplicate offers point to their canonical via canonical_offer_id.
  ```

**But implementation uses repost_count-only strategy:**

- `repost_decisions.md:92`: "NO new offer row is created"
- Implementation in `offerPersistence.ts` skips insert entirely

**What's Missing:**

- No statement like: "v1 Strategy: Duplicates never create offer rows. The canonical_offer_id field exists for potential future batch canonicalization but is intentionally unused during ingestion."

**Risk:** Future developers might see:

- Schema field `canonical_offer_id`
- Function `markOfferAsDuplicate()`
- Migration comment "Duplicate offers point to their canonical"

...and assume the system creates duplicate rows.

---

### ❌ 2. CRITICAL: last_seen_at Semantics Missing from Decision Docs

**Problem:** The field `last_seen_at` is mentioned in repost_decisions.md but its **computation semantics** are not documented.

**What's Documented:**

- `repost_decisions.md:95`: "Update last_seen_at of the canonical offer" ✅
- `03_define_repost_detection.md:71`: "lastSeenAt = now() (or run timestamp)" ⚠️ Vague

**What's Missing:**

- Priority formula: `effectiveSeenAt = updatedAt || publishedAt || now()`
- This is implemented in `offerPersistence.ts:computeEffectiveSeenAt()` but not documented

**Inconsistency:**

- `03_define_repost_detection.md:71` says "now()"
- Actual implementation prefers `updatedAt` then `publishedAt`

**Risk:** Developers might implement `last_seen_at = new Date()` instead of using offer timestamps.

---

### ⚠️ 3. MINOR: Threshold Terminology Inconsistency

**`03_define_repost_detection.md:56`:**

> "Default duplicate threshold: **>= 90%** token similarity"

**`repost_decisions.md:58`:**

> "DESC_SIM_THRESHOLD = 0.90"

**Ambiguity:**

- Original doc uses "90%" (percentage)
- Final doc uses "0.90" (decimal)

Both are mathematically equivalent, but mixing notation could cause confusion.

**Finding:** ⚠️ Minor. Clarify in final doc that 0.90 = 90% similarity.

---

### ⚠️ 4. MINOR: "TBD" Threshold Still Present in Original Doc

**`03_define_repost_detection.md:57`:**

> "If title is strongly matching: use a **lower** threshold (TBD constant, e.g. 80–85%)."

**Problem:** This is resolved in `repost_decisions.md` (0.85 for future), but original doc still says "TBD".

**Finding:** ⚠️ Minor inconsistency. Original doc should reference final doc for resolution.

---

## Consistency Check: Docs vs Implementation

### ✅ No Conflicts Found

Audit A confirmed implementation matches `repost_decisions.md` exactly:

- ✅ Exact title fast-path
- ✅ Multiset similarity 0.90
- ✅ normalizeToTokens() used
- ✅ Missing description skips detection
- ✅ Deterministic tie-breaking
- ✅ repost_count used in aggregation (1 + repost_count formula)

**Finding:** Implementation is faithful to decision doc. No code vs doc conflicts.

---

## Missing "When We Will Revisit This" Section

### ⚠️ No Explicit Future Roadmap

**Current State:**

- `repost_decisions.md:145-153` lists "Future extensions (out of scope for v1)"
- Items listed:
  - content_fingerprint pre-filtering ✅
  - Fuzzy title matching ✅
  - Configurable thresholds per provider ✅
  - Advanced similarity metrics ✅

**What's Missing:**

- **When** these will be revisited (which milestone?)
- **Triggers** for revisiting (performance issues? false positive rate?)
- **Decision criteria** (what data would justify changing thresholds?)

**Recommendation:** Add section to `repost_decisions.md`:

```markdown
## 9. When to Revisit These Decisions

This section will be reviewed when:

- **Performance issues** arise (candidate count > 100 for a company)
- **False positive rate** exceeds 5% (requires telemetry - see M6)
- **Provider-specific behavior** differs significantly from InfoJobs
- **M6 Operationalization** milestone (scheduled performance review)

Relevant metrics to track (M6):

- Duplicate detection rate per run
- Detection reason distribution (exact_title vs desc_similarity)
- Similarity score distribution for near-misses (<0.90)
```

---

## Recommended Minimal Doc Edits

### 1. Add "Persistence Strategy" Section to repost_decisions.md

**Location:** After section 4 ("Persistence behavior")

**Add:**

```markdown
## 4.1. V1 Persistence Strategy (Important)

**Current Implementation (v1):**

- Duplicates **never create offer rows** during ingestion
- Only the canonical offer exists in the database
- `repost_count` is incremented on the canonical offer
- `canonical_offer_id` field exists in schema but is **intentionally unused** by ingestion

**Why canonical_offer_id exists:**

- Reserved for potential future batch retroactive canonicalization
- Allows post-hoc analysis of historical duplicates
- Not used in production ingestion pipeline (v1)

**Function `markOfferAsDuplicate()`:**

- Exists in `offersRepo.ts` but is **not called** during ingestion
- Used only in test/verification scripts
- Would be used if strategy changes to create duplicate rows

**Schema Design Note:**
The migration comments suggest a "row-per-duplicate" strategy, but v1
implementation chose the simpler "repost_count-only" approach for:

- DB cleanliness (fewer rows)
- Simpler aggregation (no need to filter duplicates)
- Lower storage overhead

If duplicate row tracking is needed in the future, the schema is ready.
```

---

### 2. Add last_seen_at Semantics to repost_decisions.md

**Location:** In section 4 ("Persistence behavior"), expand the bullet point

**Current:**

```markdown
- Update `last_seen_at` of the canonical offer
```

**Change to:**

```markdown
- Update `last_seen_at` of the canonical offer
  - Computed as: `effectiveSeenAt = updatedAt || publishedAt || now()`
  - Priority: offer's updatedAt timestamp (if available), then publishedAt, then current time
  - This represents when the provider last saw/updated this offer
  - See: `offerPersistence.ts:computeEffectiveSeenAt()` for implementation
```

---

### 3. Clarify Threshold Notation in repost_decisions.md

**Location:** Section 2 ("Similarity thresholds")

**Current:**

```markdown
DESC_SIM_THRESHOLD = 0.90

If description similarity ≥ 0.90 → treat as repost.
```

**Change to:**

```markdown
DESC_SIM_THRESHOLD = 0.90 (90% similarity)

If description similarity ≥ 0.90 → treat as repost.

Note: 0.90 means 90% of tokens overlap (multiset overlap / max token count).
```

---

### 4. Update 03_define_repost_detection.md with Deprecation Notice

**Location:** Top of file, after title

**Add:**

```markdown
**STATUS:** This is the original design exploration document.
**AUTHORITATIVE VERSION:** See `repost_decisions.md` for final implemented decisions.
This document is preserved for historical context and design rationale.
```

---

### 5. Add "When to Revisit" Section to repost_decisions.md

**Location:** New section 9, after section 8 ("Future extensions")

**Content:** (see "Missing 'When We Will Revisit This' Section" above)

---

### 6. Cross-Reference Migration Comments

**Location:** `migrations/0004_offer_canonicalization.sql`

**Current comment:**

```sql
-- Canonical offers have canonical_offer_id = NULL and track repost activity.
-- Duplicate offers point to their canonical via canonical_offer_id.
```

**Add after this:**

```sql
-- V1 IMPLEMENTATION NOTE: Current ingestion (M4) uses repost_count-only strategy.
-- Duplicates never create rows; only canonical offers exist with repost_count > 0.
-- The canonical_offer_id field is reserved for potential future use.
-- See: docs/M4/repost_decisions.md section 4.1 for strategy explanation.
```

---

## Summary Table: Documentation Status

| Topic                      | Primary Doc         | Clarity        | Consistency           | Gaps                  |
| -------------------------- | ------------------- | -------------- | --------------------- | --------------------- |
| **Detection algorithm**    | repost_decisions.md | ✅ Clear       | ✅ Consistent         | None                  |
| **Thresholds**             | repost_decisions.md | ✅ Clear       | ⚠️ Minor notation     | Clarify 0.90 = 90%    |
| **Tokenization**           | repost_decisions.md | ✅ Clear       | ✅ Consistent         | None                  |
| **Required fields**        | repost_decisions.md | ✅ Clear       | ✅ Consistent         | None                  |
| **Aggregation impact**     | repost_decisions.md | ✅ Clear       | ✅ Consistent         | None                  |
| **Persistence strategy**   | repost_decisions.md | ❌ **Missing** | ⚠️ Schema ambiguous   | **Add section 4.1**   |
| **last_seen_at semantics** | N/A                 | ❌ **Missing** | ⚠️ Vague in 03_define | **Add to section 4**  |
| **Future enhancements**    | repost_decisions.md | ✅ Clear       | ✅ Consistent         | Add "when to revisit" |
| **Doc hierarchy**          | Both                | ✅ Clear       | ✅ Consistent         | None                  |

---

## Priority Recommendations

### 🔴 CRITICAL (Do Immediately)

1. **Add section 4.1 to repost_decisions.md** (15 minutes)
   - Explicitly state "v1: never create duplicate rows"
   - Explain canonical_offer_id reserved for future
   - Document markOfferAsDuplicate() is unused

2. **Document last_seen_at semantics** (10 minutes)
   - Add to section 4 of repost_decisions.md
   - Show priority formula: updatedAt || publishedAt || now()

3. **Add migration comment** (5 minutes)
   - Clarify v1 strategy in 0004_offer_canonicalization.sql

### 🟡 MEDIUM (Next Documentation Pass)

4. **Add "When to Revisit" section** (20 minutes)
   - New section 9 in repost_decisions.md
   - List triggers and metrics

5. **Clarify threshold notation** (5 minutes)
   - Add "(90% similarity)" next to 0.90

6. **Deprecation notice on 03_define_repost_detection.md** (5 minutes)
   - Add status header pointing to authoritative doc

### 🟢 LOW (Nice to Have)

7. **Update ordered-milestones.md** (10 minutes)
   - Add note in M4.3 about implemented strategy

---

## Conclusion

**Overall Assessment:** Documentation is **well-structured** with **clear authority hierarchy**, but has **two critical gaps** that could cause significant confusion:

1. **Missing explicit "no duplicate rows" statement** in repost_decisions.md
2. **Missing last_seen_at computation semantics** in any design doc

These gaps are particularly risky because:

- Schema and function names suggest a different strategy than implemented
- Developers might implement last_seen_at incorrectly

**Immediate action on items 1-3 (30 minutes total) will eliminate confusion risk.**

The remaining recommendations improve clarity and future-proofing but are not critical for current correctness.

---

## Final Verdict

✅ **Single source of truth exists** (`repost_decisions.md`)  
✅ **No doc-to-doc conflicts** on implemented features  
✅ **Implementation matches docs** (confirmed by Audit A)  
❌ **Critical gap:** Persistence strategy not explicit  
❌ **Critical gap:** last_seen_at semantics missing

**Action Required:** Add 2 sections to repost_decisions.md + 1 migration comment (30 min work).
