# Phase 2 Audit — Signal Correctness

**What works well**
- Catalog loading is fail-fast and structured: JSON is read, validated, then compiled into runtime maps and token sequences via `loadCatalog` → `validateCatalogRaw` → `compileCatalog`. (`src/catalog/loader.ts:loadCatalog`, `src/utils/catalogValidation.ts:validateCatalogRaw`, `src/catalog/loader.ts:compileCatalog`)
- Normalization is consistently reused across catalog compilation, matcher, and repost detection, which keeps token boundaries aligned. (`src/utils/textNormalization.ts:normalizeToTokens`, `src/catalog/loader.ts:compileCatalog`, `src/signal/matcher/matcher.ts:matchOffer`, `src/signal/repost/repostDetection.ts:detectRepostDuplicate`, `src/signal/repost/offerFingerprint.ts:computeOfferFingerprint`)
- Negation handling is encapsulated and heavily unit-tested across boundary cases. (`src/signal/matcher/negation.ts:isNegated`, `tests/unit/negation.test.ts`)
- Scoring rules (tier weights, field weights, phrase boosts, clamping) are centralized and covered by unit tests. (`src/constants/scoring.ts`, `src/signal/scorer/scorer.ts:scoreOffer`, `tests/unit/scorer.test.ts`)

**Findings**

**High**
- No high-severity correctness defects observed in current signal scope during review of catalog, matcher, scorer, and repost logic. (`src/catalog/loader.ts:compileCatalog`, `src/signal/matcher/matcher.ts:matchOffer`, `src/signal/scorer/scorer.ts:scoreOffer`, `src/signal/repost/repostDetection.ts:detectRepostDuplicate`)

**Medium**
- Phrase tier values are compiled into runtime (`PhraseRuntime.tier`) but ignored during scoring; all phrases receive the same `PHRASE_BOOST_POINTS`. This can diverge from catalog intent if tiers are meant to weight phrases. (`src/catalog/loader.ts:compileCatalog`, `src/signal/scorer/scorer.ts:aggregatePhraseContributions`, `src/constants/scoring.ts:PHRASE_BOOST_POINTS`)
- Repost detection fast-path treats any exact title-token match as a duplicate without checking descriptions, which can cause false positives for generic titles. (`src/signal/repost/repostDetection.ts:detectRepostDuplicate`, `src/utils/textNormalization.ts:normalizeToTokens`)
- `uniqueCategories` and `uniqueKeywords` are computed from all hits (including negated hits) and are then surfaced in `ScoreResult.reasons`, which can misrepresent active signal coverage. (`src/signal/matcher/matcher.ts:matchOffer`, `src/signal/scorer/scorer.ts:scoreOffer`, `src/types/scoring.ts`)

**Low**
- `MIN_SCORE` is defined but not used in scoring or filtering flows in this phase, which may cause confusion about filtering semantics. (`src/constants/scoring.ts:MIN_SCORE`, `src/signal/scorer/scorer.ts:scoreOffer`)
- Token boundary behavior is entirely driven by `TOKEN_SEPARATOR_PATTERN`; tokens like `node.js` split into `node` + `js`, while tokens like `c++` remain intact. Catalog aliases must be authored to match these boundaries. (`src/constants/textNormalization.ts:TOKEN_SEPARATOR_PATTERN`, `src/utils/textNormalization.ts:normalizeToTokens`, `src/catalog/loader.ts:compileCatalog`)

**Catalog**
- Load/validate/compile pipeline: `loadCatalog` reads `CATALOG_PATH`, parses JSON, validates with `validateCatalogRaw`, then compiles categories, keywords, and phrases into runtime maps and token sequences. (`src/catalog/loader.ts:loadCatalog`, `src/constants/catalog.ts:CATALOG_PATH`, `src/utils/catalogValidation.ts:validateCatalogRaw`, `src/catalog/loader.ts:compileCatalog`)
- Validation checks include non-empty strings, tier range (1–3), duplicate IDs, and category reference integrity. (`src/utils/catalogValidation.ts:validateCatalogRaw`, `src/utils/catalogValidation.ts:validateTier`, `src/utils/catalogValidation.ts:checkDuplicateIds`, `src/utils/catalogValidation.ts:validateCategoryReferences`)
- Normalization uses `normalizeToTokens` (lowercase, diacritic removal, token split by `TOKEN_SEPARATOR_PATTERN`), and the same normalization is applied to both catalog aliases and offer text, keeping boundary rules consistent across matching. (`src/utils/textNormalization.ts:normalizeToTokens`, `src/constants/textNormalization.ts:TOKEN_SEPARATOR_PATTERN`, `src/catalog/loader.ts:compileCatalog`, `src/signal/matcher/matcher.ts:matchOffer`)
- Boundary sensitivity: any catalog alias containing punctuation that is treated as a separator will be split into multiple tokens and will only match if the offer tokens are consecutive in that order. (`src/constants/textNormalization.ts:TOKEN_SEPARATOR_PATTERN`, `src/utils/textNormalization.ts:normalizeToTokens`, `src/signal/matcher/matcher.ts:matchField`)

**Matcher**
- Keyword matching uses exact token equality for single-token aliases and exact consecutive sequence matching for multi-token aliases, with tokenization providing word-boundary enforcement. (`src/signal/matcher/matcher.ts:matchField`, `src/utils/textNormalization.ts:normalizeToTokens`)
- Phrase matching uses the same consecutive token sequence matching as multi-token keywords and is limited to title and description fields. (`src/signal/matcher/matcher.ts:matchPhrases`, `src/signal/matcher/matcher.ts:matchOffer`)
- Negation gating is applied at match time and marks hits as negated if a cue token appears within a before/after window around the match. (`src/signal/matcher/negation.ts:isNegated`, `src/constants/negation.ts:NEGATION_CUES`, `src/constants/negation.ts:NEGATION_WINDOW_BEFORE`, `src/constants/negation.ts:NEGATION_WINDOW_AFTER`)
- Word-boundary and negation behaviors are covered by unit tests for keywords and phrases. (`tests/unit/matcher.keywords.test.ts`, `tests/unit/matcher.phrases.test.ts`, `tests/unit/negation.test.ts`)

**Scorer**
- Scoring uses tier weight × field weight per category, caps to one hit per category, adds fixed phrase boosts per unique phrase, then clamps to `MAX_SCORE` and rounds. (`src/signal/scorer/scorer.ts:scoreOffer`, `src/signal/scorer/scorer.ts:aggregateCategoryContributions`, `src/signal/scorer/scorer.ts:aggregatePhraseContributions`, `src/constants/scoring.ts:TIER_WEIGHTS`, `src/constants/scoring.ts:FIELD_WEIGHTS`, `src/constants/scoring.ts:PHRASE_BOOST_POINTS`, `src/constants/scoring.ts:MAX_SCORE`)
- Negated hits are excluded from scoring, and counts of negated hits are included in reasons. (`src/signal/scorer/scorer.ts:scoreOffer`)
- Tunables currently live in `src/constants/scoring.ts`. (`src/constants/scoring.ts`)

**Repost Detection**
- Fingerprint fast-path computes a SHA-256 hash over normalized title + description tokens; missing title or description yields `null`. (`src/signal/repost/offerFingerprint.ts:computeOfferFingerprint`, `src/utils/textNormalization.ts:normalizeToTokens`)
- Duplicate detection uses exact title-token match as the highest-priority fast-path, then falls back to description multiset similarity using `DESC_SIM_THRESHOLD`, with deterministic tie-breaking on timestamps and ID. (`src/signal/repost/repostDetection.ts:detectRepostDuplicate`, `src/signal/repost/repostDetection.ts:isCandidateBetter`, `src/signal/repost/repostDetection.ts:getMostRecentTimestamp`, `src/constants/repost.ts:DESC_SIM_THRESHOLD`)
- Collision risk for fingerprints is extremely low but not zero due to SHA-256; collisions would be treated as duplicates by the fast-path. (`src/signal/repost/offerFingerprint.ts:computeOfferFingerprint`)

**Test Alignment (Rules → Coverage)**
- Tokenization and separator rules → `tests/unit/textNormalization.test.ts` (tests for diacritics, separators, C++, negation tokens). (`src/utils/textNormalization.ts:normalizeToTokens`, `tests/unit/textNormalization.test.ts`)
- Negation window behavior → `tests/unit/negation.test.ts` (before/after windows, boundaries, cue types). (`src/signal/matcher/negation.ts:isNegated`, `tests/unit/negation.test.ts`)
- Keyword matching boundaries and multi-token sequences → `tests/unit/matcher.keywords.test.ts`. (`src/signal/matcher/matcher.ts:matchField`, `tests/unit/matcher.keywords.test.ts`)
- Phrase matching sequences and punctuation handling → `tests/unit/matcher.phrases.test.ts`. (`src/signal/matcher/matcher.ts:matchPhrases`, `tests/unit/matcher.phrases.test.ts`)
- Scoring weights, category caps, phrase boosts, clamping, negation gating → `tests/unit/scorer.test.ts`. (`src/signal/scorer/scorer.ts:scoreOffer`, `tests/unit/scorer.test.ts`)
- Repost duplicate detection (title fast-path, desc similarity, tie-breaking) → `tests/unit/repostDetection.test.ts`. (`src/signal/repost/repostDetection.ts:detectRepostDuplicate`, `tests/unit/repostDetection.test.ts`)
- Fingerprint determinism and normalization stability → `tests/unit/offerFingerprint.test.ts`. (`src/signal/repost/offerFingerprint.ts:computeOfferFingerprint`, `tests/unit/offerFingerprint.test.ts`)
- Gap: No unit tests cover catalog JSON validation or compilation failure modes. (`src/utils/catalogValidation.ts:validateCatalogRaw`, `src/catalog/loader.ts:compileCatalog`)
- Gap: No unit tests assert that phrase tier influences scoring (currently unused). (`src/catalog/loader.ts:compileCatalog`, `src/signal/scorer/scorer.ts:aggregatePhraseContributions`)

**Top 10 Tunables To Centralize**
1. `TIER_WEIGHTS` — current: `src/constants/scoring.ts` — suggested destination: `src/constants/signal.ts`. (`src/constants/scoring.ts:TIER_WEIGHTS`)
2. `FIELD_WEIGHTS` — current: `src/constants/scoring.ts` — suggested destination: `src/constants/signal.ts`. (`src/constants/scoring.ts:FIELD_WEIGHTS`)
3. `PHRASE_BOOST_POINTS` — current: `src/constants/scoring.ts` — suggested destination: `src/constants/signal.ts`. (`src/constants/scoring.ts:PHRASE_BOOST_POINTS`)
4. `MAX_SCORE` — current: `src/constants/scoring.ts` — suggested destination: `src/constants/signal.ts`. (`src/constants/scoring.ts:MAX_SCORE`)
5. `STRONG_THRESHOLD` — current: `src/constants/scoring.ts` — suggested destination: `src/constants/signal.ts`. (`src/constants/scoring.ts:STRONG_THRESHOLD`)
6. `TOKEN_SEPARATOR_PATTERN` — current: `src/constants/textNormalization.ts` — suggested destination: `src/constants/signal.ts`. (`src/constants/textNormalization.ts:TOKEN_SEPARATOR_PATTERN`)
7. `NEGATION_CUES` — current: `src/constants/negation.ts` — suggested destination: `src/constants/signal.ts`. (`src/constants/negation.ts:NEGATION_CUES`)
8. `NEGATION_WINDOW_BEFORE` — current: `src/constants/negation.ts` — suggested destination: `src/constants/signal.ts`. (`src/constants/negation.ts:NEGATION_WINDOW_BEFORE`)
9. `NEGATION_WINDOW_AFTER` — current: `src/constants/negation.ts` — suggested destination: `src/constants/signal.ts`. (`src/constants/negation.ts:NEGATION_WINDOW_AFTER`)
10. `DESC_SIM_THRESHOLD` — current: `src/constants/repost.ts` — suggested destination: `src/constants/signal.ts`. (`src/constants/repost.ts:DESC_SIM_THRESHOLD`)
