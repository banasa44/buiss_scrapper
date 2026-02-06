# Matching and Scoring Logic (Implementation-Accurate)

This chapter explains, precisely and only from code, how an offer is transformed into a numeric score.

## Preconditions (When Scoring Runs)
- Scoring is executed in `src/ingestion/ingestOffers.ts` for offers that are ingested as **canonical rows** (not repost duplicates) and that are `JobOfferDetail` (the code checks `"description" in offer`).
- If an offer is detected as a repost duplicate, ingestion skips scoring entirely because no new offer row is inserted (`src/ingestion/ingestOffers.ts`, `src/ingestion/offerPersistence.ts`).
- If an offer is a summary-only record (no `description` property), scoring is skipped.

---

## Section A - Text Processing

### How Text Is Normalized
Normalization is performed by `normalizeToTokens` in `src/utils/text/textNormalization.ts` and used by catalog compilation and matching.

Steps (in order):
1. Lowercase the input string.
2. Remove diacritics using Unicode NFD normalization and stripping combining marks (`src/utils/text/removeDiacritics.ts`).
3. Split into tokens using the separator pattern `TOKEN_SEPARATOR_PATTERN` in `src/constants/textNormalization.ts`:

```
/[\s\/\\|()[\]{},;:.!?"'\-_]+/
```

4. Remove empty tokens.

### Casing Rules
- All text is lowercased before tokenization.

### Accent Handling
- Accents and diacritics are removed by NFD normalization and removal of Unicode combining marks (`[\u0300-\u036f]`).

### Punctuation Stripping
- Punctuation is not stripped character-by-character. Instead, the separator regex **splits** on punctuation and separators, which removes those separators from tokens.
- Hyphens and underscores are treated as separators.
- Plus signs are **not** listed as separators, so tokens like `"c++"` remain intact.

### Tokenization Method
- Tokenization is deterministic: split on the separator regex above, then drop empty tokens.
- No stopword removal, stemming, lemmatization, or language detection is performed (`src/utils/text/textNormalization.ts`).

### Language Assumptions
- None. The system is language-agnostic except for a small set of negation cues (see Section B).
- There is no translation layer and no language-specific handling beyond diacritic removal.

### Title vs Description Treatment
- Matching is executed on **title** and **description** fields only (`src/signal/matcher/matcher.ts`).
- Company name is explicitly excluded from matching to reduce false positives (commented in `matchOffer`).
- Title and description are processed separately. Matches preserve which field they came from (`MatchField` in `src/types/matching.ts`).

---

## Section B - Matching Rules

### How a Single Keyword Is Matched
- Keywords are compiled into token sequences from `catalog.json` aliases in `src/catalog/loader.ts`.
- Matching logic is in `src/signal/matcher/matcher.ts`.
- For each token position in the offer text, every keyword alias is checked.
- A single-token alias matches when `token === aliasTokens[0]`.

### How Multi-Token Keywords and Phrases Are Matched
- Multi-token matching requires an **exact consecutive sequence** of tokens.
- For an alias or phrase with tokens `t0..tn`, a match occurs at index `i` only if:
  - `tokens[i] === t0`, and
  - `tokens[i+1] === t1`, ... , `tokens[i+n] === tn`.
- This is identical for keyword aliases and phrases (`matchField` and `matchPhrases` in `src/signal/matcher/matcher.ts`).

### Regex Matching
- No regex matching is used for keywords or phrases. Matching is token equality only.

### Boundary Rules
- Token boundaries are enforced by tokenization. There is no substring matching inside a token.
- Example implication: `"aws"` will **not** match `"awesome"`, because `"awesome"` is a distinct token after tokenization.

### Duplicate Matches Handling
- The matcher **does not deduplicate** matches. Every hit is recorded, including repeated occurrences of the same keyword or phrase.
- `MatchResult` contains full `keywordHits` and `phraseHits` arrays (`src/types/matching.ts`).
- `uniqueCategories` and `uniqueKeywords` are computed **across all hits** (negated or not) in `matchOffer`.

### Overlap Resolution
- Keyword vs phrase overlap: both are matched independently. There is **no precedence** or suppression between them.
- Multiple phrase matches: phrase hits are collected as-is in matching; scoring later deduplicates by phrase ID (see Section C).

### Negations
Negation detection is implemented in `src/signal/matcher/negation.ts` and applied **at match time**.

- Negation cues: `"no"`, `"sin"`, `"not"`, `"without"` (`src/constants/negation.ts`).
- Window sizes: `NEGATION_WINDOW_BEFORE = 8`, `NEGATION_WINDOW_AFTER = 2` (`src/constants/negation.ts`).
- For a match at `startIndex` of length `len`, negation is checked in:
  - Before window: `[startIndex - 8, startIndex)`
  - After window: `[startIndex + len, startIndex + len + 2)`
- If any cue token appears in either window, the hit is marked `isNegated = true`.
- The matched tokens themselves are excluded from the negation check.
- Negation does **not** remove the hit; it only marks it. The scorer later filters out negated hits.

---

## Section C - Scoring Formula

Scoring logic is implemented in `src/signal/scorer/scorer.ts` using constants from `src/constants/scoring.ts`.

### Scoring Inputs
- `MatchResult` from the matcher, containing keyword hits and phrase hits.
- `CatalogRuntime`, used to look up category tiers.

### Weights And Constants
From `src/constants/scoring.ts`:
- `TIER_WEIGHTS`: tier 3 = 4.0, tier 2 = 2.5, tier 1 = 1.0
- `FIELD_WEIGHTS`: title = 1.5, description = 1.0
- `PHRASE_BOOST_POINTS` = 1.5
- `MAX_SCORE` = 10
- `STRONG_THRESHOLD` = 6 (used later for classification in aggregation)

### Per-Category Aggregation
- Hits are grouped by `categoryId`.
- Each hit yields `points = TIER_WEIGHTS[category.tier] * FIELD_WEIGHTS[field]`.
- For each category, only the **maximum** points among its hits are retained.
- This enforces “max 1 contribution per category per offer” (no stacking).

### Phrase Aggregation
- Phrase hits are grouped by `phraseId`.
- Each unique phrase contributes exactly `PHRASE_BOOST_POINTS` once.
- Phrase tier in the catalog is **not used** in scoring.

### Final Score
- `rawScore = sum(categoryPoints) + sum(phrasePoints)`.
- `finalScore = round(clamp(rawScore, 0, MAX_SCORE))`.
- `topCategoryId` is the category with the highest points after aggregation; empty string if none.

### Strong Classification Threshold
- An offer is considered “strong” when `score >= STRONG_THRESHOLD` (`STRONG_THRESHOLD = 6`).
- This classification is applied later during company aggregation in `src/signal/aggregation/mapCompanyOfferRows.ts`.

### Pseudocode (Derived From Implementation)

```ts
// Input: MatchResult + CatalogRuntime
activeKeywordHits = keywordHits.filter(h => !h.isNegated)
activePhraseHits = phraseHits.filter(h => !h.isNegated)

negatedKeywordHits = keywordHits.length - activeKeywordHits.length
negatedPhraseHits  = phraseHits.length - activePhraseHits.length

// Category aggregation
categoryHits = Map<categoryId, { hitCount, maxPoints }>()
for hit in activeKeywordHits:
  tier = catalog.categories.get(hit.categoryId).tier
  fieldWeight = FIELD_WEIGHTS[hit.field] ?? 1.0
  points = TIER_WEIGHTS[tier] * fieldWeight
  update categoryHits[hit.categoryId] with hitCount++ and maxPoints = max(maxPoints, points)

categoryContributions = categoryHits -> array sorted by points desc

// Phrase aggregation
phraseHitsMap = Map<phraseId, hitCount>()
for hit in activePhraseHits:
  phraseHitsMap[hit.phraseId]++

phraseContributions = phraseHitsMap -> array with points = PHRASE_BOOST_POINTS

rawScore = sum(categoryContributions.points) + sum(phraseContributions.points)
finalScore = round(clamp(rawScore, 0, MAX_SCORE))

topCategoryId = categoryContributions[0]?.categoryId ?? ""

return {
  score: finalScore,
  topCategoryId,
  reasons: {
    rawScore,
    finalScore,
    categories: categoryContributions,
    phrases: phraseContributions,
    uniqueCategories: matchResult.uniqueCategories,
    uniqueKeywords: matchResult.uniqueKeywords,
    negatedKeywordHits,
    negatedPhraseHits,
  }
}
```

---

## Section D - Explanation Generation

### What Evidence Is Stored
- The matcher produces detailed hit-level evidence (`MatchHit`, `PhraseMatchHit`) with:
  - `keywordId` / `phraseId`
  - `field` (`title` or `description`)
  - `tokenIndex`
  - `matchedTokens`
  - `isNegated`
- These per-hit details are **not** persisted directly to the database.

### What Is Persisted (And Used For Explanations)
- The scorer produces a `ScoreResult` (`src/types/scoring.ts`).
- This `ScoreResult` is stored as JSON in `matches.matched_keywords_json` via `upsertMatch` (`src/db/repos/matchesRepo.ts`).
- The `ScoreResult` includes:
  - `score` and `topCategoryId`
  - `reasons` with:
    - `rawScore` and `finalScore`
    - `categories` (categoryId, hitCount, points)
    - `phrases` (phraseId, hitCount, points)
    - `uniqueCategories`, `uniqueKeywords`
    - `negatedKeywordHits`, `negatedPhraseHits`
- `matches.reasons` exists in schema but is not populated by current ingestion code (it is passed as `null`).

### What A Client Can See
- In the current client-facing export (Google Sheets), **per-offer explanations are not exported**.
- The Sheets export only exposes **company-level aggregated metrics** and the resolved top category label (`src/sheets/companyRowMapper.ts`).
- The most detailed explanation available in the system is the `ScoreResult` JSON stored in `matches.matched_keywords_json`.

---

## Summary
An offer becomes a numeric score through deterministic tokenization, exact token-sequence matching against catalog aliases and phrases, negation marking, and a scoring formula that aggregates per-category maxima and per-phrase boosts, then clamps and rounds the result. The system records an auditable `ScoreResult` with category and phrase contributions but does not persist raw per-hit match evidence or export per-offer explanations to the client-facing sheet.
