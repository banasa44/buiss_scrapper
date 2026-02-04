# AUDIT REPORT A — Repost/Duplicate Feature Completeness

**Date:** February 4, 2026  
**Auditor:** Senior Engineer (Code Review)  
**Scope:** Repost/duplicate detection implementation vs design decisions

---

## Executive Summary

**Status:** ✅ **COMPLETE AND CONSISTENT**

The repost/duplicate feature is fully implemented and matches the design specification in `repost_decisions.md`. All critical behaviors are correctly implemented with no semantic mismatches found.

---

## 1. last_seen_at Update Paths

### ✅ a) New canonical offers

**Code path:** `src/ingestion/offerPersistence.ts:188-192`

```typescript
// Not a duplicate - proceed with normal insert
const offerInput = buildOfferInput(offer, provider, companyId);
const offerId = upsertOffer(offerInput);

// Set last_seen_at for new canonical offer
updateOfferLastSeenAt(offerId, effectiveSeenAt);
```

**Finding:** ✅ New canonical offers have `last_seen_at` set via `updateOfferLastSeenAt()` after insert.

---

### ✅ b) Same-offer updates (same provider_offer_id)

**Code path:** `src/ingestion/offerPersistence.ts:142-157`

```typescript
if (existingOffer) {
  // Same offer seen again - treat as normal update
  const offerInput = buildOfferInput(offer, provider, companyId);

  try {
    const offerId = upsertOffer(offerInput);

    // Update last_seen_at separately (not handled by upsertOffer)
    updateOfferLastSeenAt(offerId, effectiveSeenAt);

    return { ok: true, offerId, companyId };
  }
  // ...
}
```

**Finding:** ✅ Same-offer updates (same `provider_offer_id`) call `updateOfferLastSeenAt()` to update `last_seen_at`.

---

### ✅ c) Repost duplicates (canonical bump)

**Code path:** `src/ingestion/offerPersistence.ts:176-181`

```typescript
if (decision.kind === "duplicate") {
  // Repost detected - update canonical offer, skip insert
  incrementOfferRepostCount(decision.canonicalOfferId, effectiveSeenAt);

  logger.info("Repost duplicate detected", {
    /* ... */
  });

  return { ok: true, reason: "repost_duplicate" /* ... */ };
}
```

**Repository implementation:** `src/db/repos/offersRepo.ts:147-164`

```typescript
export function incrementOfferRepostCount(
  offerId: number,
  lastSeenAt: string | null,
): void {
  const result = db
    .prepare(
      `
    UPDATE offers
    SET repost_count = repost_count + 1,
        last_seen_at = COALESCE(?, last_seen_at),
        last_updated_at = datetime('now')
    WHERE id = ?
  `,
    )
    .run(lastSeenAt, offerId);
  // ...
}
```

**Finding:** ✅ Repost duplicates update `last_seen_at` via `incrementOfferRepostCount()` using `COALESCE(?, last_seen_at)`.

---

### ✅ effectiveSeenAt Computation

**Code path:** `src/ingestion/offerPersistence.ts:56-67`

```typescript
function computeEffectiveSeenAt(offer: PersistOfferInput["offer"]): string {
  return offer.updatedAt || offer.publishedAt || new Date().toISOString();
}
```

**Decision doc reference:** `last_seen_at semantics: effectiveSeenAt = updatedAt || publishedAt || now()`

**Finding:** ✅ Matches decision doc exactly.

---

## 2. canonical_offer_id Usage

### ✅ Duplicates NOT inserted as rows during ingestion

**Evidence:**

1. **Repost path skips insert entirely:** `src/ingestion/offerPersistence.ts:176-195`

   ```typescript
   if (decision.kind === "duplicate") {
     // Repost detected - update canonical offer, skip insert
     incrementOfferRepostCount(decision.canonicalOfferId, effectiveSeenAt);
     // ...
     return { ok: true, reason: "repost_duplicate" /* ... */ };
   }

   // Not a duplicate - proceed with normal insert
   const offerInput = buildOfferInput(offer, provider, companyId);
   const offerId = upsertOffer(offerInput);
   ```

2. **Ingestion skips matching/scoring for reposts:** `src/ingestion/ingestOffers.ts:55-69`
   ```typescript
   if ("reason" in result && result.reason === "repost_duplicate") {
     // Repost duplicate detected - no new offer inserted
     duplicates++;
     // ...
     // Skip matching/scoring for reposts (no new offer row exists)
     continue;
   }
   ```

**Finding:** ✅ Duplicates are NEVER inserted as rows during ingestion. The `canonical_offer_id` field is **intentionally unused** by the current pipeline.

---

### ⚠️ markOfferAsDuplicate() exists but unused in production

**Code location:** `src/db/repos/offersRepo.ts:114-131`

**Only usage:** Test/verification script `src/db/verify.ts:243`

**Finding:** This function exists for potential future use (e.g., batch retroactive canonicalization) but is NOT part of the current ingestion pipeline. This is intentional per the repost design: duplicates don't create rows.

**Status:** Not a gap — this is by design.

---

## 3. repost_count in Aggregation

### ✅ Used exactly once for activity-weighted offer_count

**Location:** `src/signal/aggregation/aggregateCompany.ts:104-108`

```typescript
// Compute activity-weighted offerCount
// For each canonical offer, contributes (1 + repostCount)
const offerCount = canonicalOffers.reduce(
  (sum, o) => sum + (1 + o.repostCount),
  0,
);
```

**Formula verification:**

- ✅ `offerCount = sum(1 + repost_count)` over canonical offers
- ✅ Applied only to canonical offers (filtered via `canonicalOfferId === null`)
- ✅ `strongOfferCount` is NOT weighted (counted directly): line 137

**Data flow:**

1. **DB query fetches repost_count:** `src/db/repos/offersRepo.ts:312-328`
2. **Mapped to AggregatableOffer:** `src/signal/aggregation/mapCompanyOfferRows.ts:32`
3. **Used in aggregation formula:** `src/signal/aggregation/aggregateCompany.ts:104-108`

**Finding:** ✅ `repost_count` is used exactly once, correctly implementing activity-weighted offer count.

---

## 4. Semantic Consistency vs REPOST_DECISIONS.md

### ✅ Exact title match fast-path

**Decision doc:** "If titles match exactly → we consider it a repost immediately and DO NOT compare descriptions."

**Implementation:** `src/signal/repost/repostDetection.ts:84-98`

```typescript
// Fast-path: Check for exact title matches
for (const candidate of candidates) {
  const candidateTitleTokens = normalizeToTokens(candidateTitle);

  if (areTokenSequencesEqual(incomingTitleTokens, candidateTitleTokens)) {
    return {
      kind: "duplicate",
      canonicalOfferId: candidate.id,
      reason: "exact_title",
      // ...
    };
  }
}
```

**Finding:** ✅ Correct implementation.

---

### ✅ Multiset similarity threshold

**Decision doc:**

- `DESC_SIM_THRESHOLD = 0.90`
- `similarity = overlap / max(tokenCount(old), tokenCount(new))`
- Uses multiset (bag-of-words), not set

**Implementation:**

1. **Constant:** `src/constants/repost.ts:15` → `DESC_SIM_THRESHOLD = 0.9` ✅

2. **Formula:** `src/signal/repost/repostDetection.ts:209-235`
   ```typescript
   function computeMultisetSimilarity(
     counts1: Map<string, number>,
     counts2: Map<string, number>,
     len1: number,
     len2: number,
   ): number {
     // ...
     let overlap = 0;
     for (const [token, count1] of counts1) {
       const count2 = counts2.get(token) || 0;
       overlap += Math.min(count1, count2); // MULTISET
     }

     const maxLen = Math.max(len1, len2);
     return overlap / maxLen;
   }
   ```

**Finding:** ✅ Multiset similarity with 0.90 threshold, matches decision doc exactly.

---

### ✅ Tokenization consistency

**Decision doc:** "normalizeToTokens() is used for both title and description"

**Implementation:** `src/signal/repost/repostDetection.ts:80-108`

- Title normalization: `normalizeToTokens(incomingTitle)` ✅
- Description normalization: `normalizeToTokens(incomingDescription)` ✅

**Finding:** ✅ Consistent with M3 matching.

---

### ✅ Required fields

**Decision doc:** "title and description must exist and be non-empty"

**Implementation:** `src/signal/repost/repostDetection.ts:100-107`

```typescript
// Fallback: Description similarity comparison
// Only proceed if incoming offer has a description
if (!incomingDescription) {
  return {
    kind: "not_duplicate",
    reason: "missing_description",
  };
}
```

**Finding:** ✅ Missing description skips repost detection (returns `not_duplicate`).

---

### ✅ Tie-breaking

**Decision doc:** Not explicitly specified in repost_decisions.md, but should be deterministic.

**Implementation:** `src/signal/repost/repostDetection.ts:118-133`

```typescript
// Update best candidate if this one is better
if (
  similarity > bestSimilarity ||
  (similarity === bestSimilarity &&
    bestCandidate &&
    isCandidateBetter(candidate, bestCandidate))
) {
  bestCandidate = candidate;
  bestSimilarity = similarity;
}
```

**Tie-breaker logic:** lines 251-272

1. Most recent timestamp (lastSeenAt > publishedAt > updatedAt)
2. Smallest ID

**Finding:** ✅ Deterministic tie-breaking implemented.

---

## 5. Additional Verification

### ✅ Aggregation triggered for reposts

**Code:** `src/ingestion/ingestOffers.ts:63-66`

```typescript
// Track affected company for aggregation (repost_count changed)
if (affectedCompanyIds) {
  affectedCompanyIds.add(result.companyId);
}
```

**Finding:** ✅ Reposts correctly add company to `affectedCompanyIds`, triggering aggregation.

---

## 6. Future Enhancements (Intentionally Deferred)

### ⚠️ Lower threshold DESC_SIM_THRESHOLD_WITH_TITLE_HINT not implemented

**Decision doc section 2:**

> "Lower threshold when title is strongly similar: DESC_SIM_THRESHOLD_WITH_TITLE_HINT = 0.85"
> "For the initial implementation, only the 0.90 threshold will be used"

**Current state:** Only 0.90 threshold is implemented.

**Assessment:** This is **intentionally deferred** per the decision doc ("future enhancement hook"). Not a gap.

---

### ⚠️ content_fingerprint not used for pre-filtering

**Decision doc section 8 (future):**

> "Using content_fingerprint for pre-filtering candidates"

**Current state:** `content_fingerprint` field exists in schema but is not populated during ingestion. The function `findCanonicalOffersByFingerprint()` exists but is unused.

**Evidence:** `src/ingestion/offerPersistence.ts:170` uses `listCanonicalOffersForRepost()` which doesn't filter by fingerprint.

**Assessment:** Marked as "out of scope for v1" in decision doc. Not a gap.

---

## Summary Table

| Check                                  | Status | Notes                                                            |
| -------------------------------------- | ------ | ---------------------------------------------------------------- |
| **1a) New canonical last_seen_at**     | ✅     | Set via `updateOfferLastSeenAt()`                                |
| **1b) Same-offer update last_seen_at** | ✅     | Set via `updateOfferLastSeenAt()`                                |
| **1c) Repost canonical last_seen_at**  | ✅     | Set via `incrementOfferRepostCount()` with COALESCE              |
| **2) Duplicates never inserted**       | ✅     | Repost path skips insert entirely                                |
| **2) canonical_offer_id unused**       | ✅     | Intentional; `markOfferAsDuplicate()` exists for future use only |
| **3) repost_count formula**            | ✅     | `offerCount = sum(1 + repost_count)` correctly implemented       |
| **4) Exact title fast-path**           | ✅     | Matches decision doc                                             |
| **4) Multiset similarity 0.90**        | ✅     | Correct implementation                                           |
| **4) Tokenization consistency**        | ✅     | Uses `normalizeToTokens()` everywhere                            |
| **4) Required fields**                 | ✅     | Missing description skips detection                              |
| **4) Tie-breaking**                    | ✅     | Deterministic (timestamp → id)                                   |
| **Aggregation trigger**                | ✅     | Reposts add company to affected set                              |

---

## Conclusion

**The repost/duplicate feature is COMPLETE and CONSISTENT with repost_decisions.md.**

All critical behaviors are correctly implemented:

- ✅ `last_seen_at` updated in all three scenarios
- ✅ Duplicates never create new offer rows
- ✅ `repost_count` used exactly once in aggregation with correct formula
- ✅ Detection logic matches decision doc (exact title, multiset similarity, thresholds)
- ✅ Pure functions, deterministic tie-breaking, proper tokenization

**No semantic mismatches found.**

Future enhancements (0.85 threshold, content_fingerprint) are intentionally deferred per decision doc.

---

## Recommendations

1. **None required** — implementation is correct and complete.
2. Consider adding integration tests for repost detection edge cases (if not already present).
3. Document the intentional non-use of `canonical_offer_id` in code comments to prevent future confusion.
