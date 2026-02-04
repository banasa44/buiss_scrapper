# Repost Detection – Final Design Decisions

This document records the concrete decisions taken for implementing real repost/duplicate detection in the ingestion pipeline.

It refines and clarifies the original ideas from `03_define_repost_detection.md`.

---

## 1. What counts as a repost?

A new incoming offer is considered a **repost (duplicate)** of an existing canonical offer when BOTH of the following are true:

### A) Title match rule

- Titles must match **exactly after normalization**.
- Normalization is done using the existing `normalizeToTokens()` function.
- After normalization, the sequence of tokens must be identical (same order and same tokens).

**If titles match exactly → we consider it a repost immediately and DO NOT compare descriptions.**

This acts as a strong fast-path for very clear duplicates.

---

### B) Description similarity rule

If titles do **not** match exactly, we fall back to comparing descriptions.

#### Preconditions

- The new offer MUST have a non-empty description.
- If `description` is missing or empty → repost detection is **skipped entirely** for this offer.

Rationale: an offer without description cannot be reliably compared.

#### Similarity algorithm

- Descriptions are tokenized using `normalizeToTokens()` (same as matcher).
- Similarity is computed using **multiset token overlap** (bag-of-words comparison).

We intentionally use **multiset overlap** instead of set overlap because:

- it better captures near-verbatim reposts,
- it is more faithful to the idea of “85–90% of the text is the same”.

#### Metric

## similarity = (number of overlapping tokens, counting repetitions)

(max(tokenCount(old), tokenCount(new)))

---

## 2. Similarity thresholds

We use two thresholds:

### Default threshold

DESC_SIM_THRESHOLD = 0.90

If description similarity ≥ 0.90 → treat as repost.

### Lower threshold when title is strongly similar

If titles are not exactly equal but still very close, we allow a slightly lower threshold:

DESC_SIM_THRESHOLD_WITH_TITLE_HINT = 0.85

This case only applies when titles are not exact matches but share high structural similarity (future enhancement hook).

For the initial implementation, only the **0.90 threshold** will be used, because exact-title matches already short-circuit the process.

---

## 3. Scope of comparison

Repost detection is performed only:

- Within the **same company identity**
- Against existing **canonical offers only**
- Typically within a reasonable recency window (handled at query level)

We never compare offers across different companies.

---

## 4. Persistence behavior

When a repost is detected:

- **NO new offer row is created**
- Instead:
  - Increment `repost_count` on the canonical offer
  - Update `last_seen_at` of the canonical offer
- No scoring or matching is executed for the repost

This keeps the database clean and avoids artificial inflation of metrics.

---

## 5. Required fields

An incoming offer is eligible for repost detection only if:

- `title` exists and is non-empty
- `description` exists and is non-empty

If either is missing:

- Repost detection is skipped
- The offer is treated as a normal new offer

---

## 6. Tokenization

All text processing for repost detection must reuse the existing system normalization:

- `normalizeToTokens()` is used for both title and description
- No special or separate tokenization logic is introduced

This guarantees consistency with M3 matching logic.

---

## 7. High-level flow

For each incoming offer:

1. Identify company
2. Fetch candidate canonical offers for that company
3. For each candidate:
   - If titles match exactly → mark as repost
   - Else if both have descriptions:
     - compute multiset similarity
     - if ≥ threshold → mark as repost
4. If repost found:
   - update canonical metadata
   - skip new offer persistence
5. If no repost found:
   - persist as new canonical offer

---

## 8. Future extensions (out of scope for v1)

Possible improvements for later:

- Using `content_fingerprint` for pre-filtering candidates
- Fuzzy title matching instead of exact only
- Configurable thresholds per provider
- More advanced similarity metrics (n-grams, TF-IDF, etc.)

---

**These rules are the authoritative definition for Task 1 implementation.**
