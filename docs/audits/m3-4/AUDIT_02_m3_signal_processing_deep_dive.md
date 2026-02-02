# AUDIT 2 — M3 Signal Processing Deep Dive (Data Flow + Edge Cases)

**Date:** February 2, 2026  
**Scope:** M3 (matcher + negation + scorer) implementation audit to prepare precise unit-testing plan  
**Status:** Implementation review only — no production code changes

---

## 1. M3 Data Flow: Input Text → Final Score

### **1.1 Input Shape**

**Type:** `JobOfferDetail` (from `src/types/clients/job_offers.ts`)

```typescript
type JobOfferDetail = {
  ref: ProviderRef; // provider, id, url
  title: string; // ✅ Matched field (required)
  company: JobOfferCompany;
  description?: string; // ✅ Matched field (optional)
  minRequirements?: string; // ❌ NOT matched
  desiredRequirements?: string; // ❌ NOT matched
  publishedAt?: string;
  updatedAt?: string;
  location?: JobOfferLocation;
  metadata?: JobOfferMetadata;
  requirementsSnippet?: string;
  // ... other fields
};
```

**Text Fields Processed:**

- ✅ `title` — always processed (required field)
- ✅ `description` — processed if present (optional)
- ❌ `company.name` — **explicitly excluded** to reduce false positives (per comment in matcher)
- ❌ `minRequirements` — not matched
- ❌ `desiredRequirements` — not matched

**Rationale for company name exclusion:**  
Company names often contain keywords (e.g., "Stripe Consulting", "Salesforce Partner") that are product/service names, not signals of USD exposure. This creates false positives.

---

### **1.2 Data Flow Pipeline**

```
JobOfferDetail
    ↓
[1] Text Normalization (normalizeToTokens)
    ↓
[2] Keyword Matching (matchField)
    ↓
[3] Phrase Matching (matchPhrases)
    ↓
[4] Negation Detection (isNegated) — inline during matching
    ↓
MatchResult { keywordHits[], phraseHits[] }
    ↓
[5] Negation Gating (filter out isNegated=true)
    ↓
[6] Category Aggregation (max 1 per category)
    ↓
[7] Phrase Aggregation (max 1 per phrase)
    ↓
[8] Score Computation (tier × field + phrases)
    ↓
[9] Clamping & Rounding ([0, MAX_SCORE], integer)
    ↓
ScoreResult { score, topCategoryId, reasons }
```

---

### **1.3 Text Normalization Rules**

**Function:** `normalizeToTokens(text: string): string[]`  
**Location:** `src/utils/textNormalization.ts`

**Steps (applied in order):**

1. **Lowercase:** `text.toLowerCase()`
2. **Remove diacritics:** NFD decomposition + remove U+0300-U+036F
   - `café` → `cafe`
   - `niño` → `nino`
   - `José` → `jose`
3. **Split on separators:** `TOKEN_SEPARATOR_PATTERN`
   - Whitespace: space, tab, newline
   - Technical: `/`, `\`, `|`, `(`, `)`, `[`, `]`, `{`, `}`, `-`, `_`
   - Punctuation: `,`, `;`, `:`, `.`, `!`, `?`, `"`, `'`
4. **Remove empty tokens:** Filter out `token.length === 0`

**What is NOT done:**

- ❌ No stopword removal (negation tokens like "no", "sin" are preserved)
- ❌ No stemming or lemmatization
- ❌ No language detection

**Separator Pattern:**

```typescript
/[\s\/\\|()[\]{},;:.!?"'\-_]+/;
```

**Example Transformations:**

```
"Full-Stack Developer (C++/Python)"
  → ["full", "stack", "developer", "c++", "python"]

"Desarrollador sin experiencia en AWS"
  → ["desarrollador", "sin", "experiencia", "en", "aws"]
  // Note: "sin" (without) is preserved for negation detection

"José, café, niño"
  → ["jose", "cafe", "nino"]
```

---

## 2. Matcher Audit

**Location:** `src/signal/matcher/matcher.ts`

### **2.1 Keyword Matching Algorithm**

**Matching Logic:**

- For each token position in offer text
- For each keyword in catalog
- Check if consecutive token sequence matches alias token sequence

**Single-Token Aliases:**

- Exact match: `token === aliasTokens[0]`
- Example: `"aws"` matches token `"aws"`

**Multi-Token Aliases:**

- First token must match: `tokens[i] === aliasTokens[0]`
- Check remaining consecutive tokens: `tokens[i+j] === aliasTokens[j]` for `j=1..length-1`
- Example: `["amazon", "web", "services"]` matches consecutive tokens `["amazon", "web", "services"]`

**Token Boundary Enforcement:**

- **Natural via tokenization** — each token is an atomic unit
- No substring matching possible
- Example: `"awesome"` tokenizes to `["awesome"]`, does NOT match `"aws"` (which is `["aws"]`)

---

### **2.2 Phrase Matching**

**Function:** `matchPhrases(tokens, catalog, field)`

**Same Algorithm as Keyword Matching:**

- Consecutive token sequence matching
- Phrases are pre-normalized into token arrays
- Example: `"pagos internacionales"` → `["pagos", "internacionales"]`

**Fields:** Only `title` and `description` (phrase boosts are content-level signals)

---

### **2.3 Synonym Handling**

**Implementation:** Each keyword has multiple **aliases** (array of strings)

**Runtime Structure:**

```typescript
type KeywordRuntime = {
  id: string; // "kw_aws"
  categoryId: string; // "cat_cloud_infra"
  canonical: string; // "AWS" (display name)
  aliasTokens: string[]; // ["aws"] or ["google", "cloud"]
};
```

**Key Behavior:**

- Each alias is a separate `KeywordRuntime` entry with **same** `id` and `categoryId`
- Matching `"aws"` or `"amazon web services"` produces hits with **same** `keywordId: "kw_aws"`
- Scoring treats them as **one keyword** (no stacking)

**Example from catalog:**

```json
{
  "id": "kw_aws",
  "categoryId": "cat_cloud_infra",
  "canonical": "AWS",
  "aliases": ["aws", "amazon web services", "ec2", "s3", "lambda"]
}
```

Compiled runtime has 5 separate `KeywordRuntime` entries:

- `{ id: "kw_aws", aliasTokens: ["aws"] }`
- `{ id: "kw_aws", aliasTokens: ["amazon", "web", "services"] }`
- `{ id: "kw_aws", aliasTokens: ["ec2"] }`
- `{ id: "kw_aws", aliasTokens: ["s3"] }`
- `{ id: "kw_aws", aliasTokens: ["lambda"] }`

All map to same `keywordId` during scoring aggregation.

---

### **2.4 Negation Handling**

**Function:** `isNegated(tokens, startIndex, length)`  
**Location:** `src/signal/matcher/negation.ts`

**Algorithm:**

```
Window = [startIndex - BEFORE, startIndex) ∪ [startIndex + length, startIndex + length + AFTER)
```

**Constants:** (from `src/constants/negation.ts`)

- `NEGATION_WINDOW_BEFORE = 8` — check 8 tokens before match
- `NEGATION_WINDOW_AFTER = 2` — check 2 tokens after match
- `NEGATION_CUES = ["no", "sin", "not", "without"]`

**Detection Logic:**

- Search for any `NEGATION_CUES` token within window
- If found → `isNegated = true`
- Match tokens themselves are **excluded** from window

**Examples:**

```typescript
// "no aws experience required" → ["no", "aws", "experience", "required"]
isNegated(tokens, 1, 1); // true
// Window before: [max(0, 1-8), 1) = [0, 1) → ["no"]
// "no" is a negation cue → negated

// "aws experience required" → ["aws", "experience", "required"]
isNegated(tokens, 0, 1); // false
// Window before: [max(0, 0-8), 0) = [0, 0) → empty
// Window after: [1, min(3, 1+2)) = [1, 3) → ["experience", "required"]
// No negation cues → not negated

// "we need aws not azure" → ["we", "need", "aws", "not", "azure"]
isNegated(tokens, 2, 1); // true (aws at index 2)
// Window after: [3, min(5, 3+2)) = [3, 5) → ["not", "azure"]
// "not" is a negation cue → negated

// "no, aws is required" → ["no", "aws", "is", "required"]
isNegated(tokens, 1, 1); // true (aws at index 1)
// Window before: [max(0, 1-8), 1) = [0, 1) → ["no"]
// "no" is a negation cue → negated (comma removed during tokenization)
```

**Edge Cases:**

- Match at start of text (index 0): window before is empty
- Match at end of text: window after is clamped to array length
- Multi-token match: `length > 1`, window excludes all matched tokens

**Failure Modes:**

- **Distance-insensitive within window:** `"no aws gcp azure docker kubernetes terraform ansible"` (8 words) — "ansible" at position 8 is NOT negated (outside window)
- **Comma/punctuation removal:** `"no, aws"` → punctuation removed, "no" and "aws" are adjacent
- **Negation cues as separate tokens:** `"noaws"` (no space) → tokenizes to `["noaws"]`, does NOT match negation cue `"no"`

---

### **2.5 MatchResult Structure**

**Type:** `MatchResult` (from `src/types/matching.ts`)

```typescript
type MatchResult = {
  keywordHits: MatchHit[];
  phraseHits: PhraseMatchHit[];
  uniqueCategories: number;
  uniqueKeywords: number;
};

type MatchHit = {
  keywordId: string;
  categoryId: string;
  field: "title" | "description" | "company";
  tokenIndex: number;
  matchedTokens: string[];
  isNegated: boolean;
};

type PhraseMatchHit = {
  phraseId: string;
  field: "title" | "description";
  tokenIndex: number;
  matchedTokens: string[];
  isNegated: boolean;
};
```

**Key Fields:**

- `isNegated` — computed **inline during matching** (not lazy)
- `matchedTokens` — actual normalized token sequence that matched
- `tokenIndex` — position in token array (for debugging/explainability)
- `uniqueCategories` — count of distinct `categoryId` values (pre-computed for quick filtering)
- `uniqueKeywords` — count of distinct `keywordId` values

---

## 3. Scorer Audit

**Location:** `src/signal/scorer/scorer.ts`

### **3.1 Score Computation Algorithm**

**Steps:**

1. **Negation Gating:**
   - Filter `keywordHits` where `isNegated === false`
   - Filter `phraseHits` where `isNegated === false`
   - Negated hits contribute **0 points** (not subtracted, just excluded)

2. **Category Aggregation:**
   - Group active keyword hits by `categoryId`
   - For each category, find hit with **highest field weight**
   - Compute `points = TIER_WEIGHTS[tier] × FIELD_WEIGHTS[field]`
   - **Max 1 contribution per category** (no stacking)

3. **Phrase Aggregation:**
   - Count **unique phrase IDs**
   - Each unique phrase contributes `PHRASE_BOOST_POINTS` once
   - Multiple occurrences of same phrase count as 1

4. **Sum Raw Score:**

   ```
   rawScore = Σ(category_points) + Σ(phrase_points)
   ```

5. **Clamp & Round:**
   ```
   finalScore = round(clamp(rawScore, 0, MAX_SCORE))
   ```

---

### **3.2 Scoring Constants**

**Location:** `src/constants/scoring.ts`

**Tier Weights:**

```typescript
TIER_WEIGHTS = {
  3: 4.0, // Strong USD signal (Cloud, Ads, Payments)
  2: 2.5, // High probability USD (CRM, Analytics)
  1: 1.0, // Contextual (Collaboration, Design)
};
```

**Field Weights:**

```typescript
FIELD_WEIGHTS = {
  title: 1.5, // Strongest signal
  description: 1.0, // Standard weight
};
```

**Phrase Boost:**

```typescript
PHRASE_BOOST_POINTS = 1.5;
```

**Score Bounds:**

```typescript
MAX_SCORE = 10;
MIN_SCORE = 0;
STRONG_THRESHOLD = 6; // Used in M4 aggregation
```

---

### **3.3 Scoring Examples**

**Example 1: Single Tier 3 keyword in title**

```
Match: "aws" in title
Category: cat_cloud_infra (tier 3)
Calculation: 4.0 × 1.5 = 6.0
Final Score: 6
```

**Example 2: Multiple keywords, same category**

```
Matches: "aws" in title, "ec2" in description
Category: cat_cloud_infra (tier 3)
Hit 1: 4.0 × 1.5 = 6.0 (title)
Hit 2: 4.0 × 1.0 = 4.0 (description)
Max per category rule: 6.0 (highest wins)
Final Score: 6
```

**Example 3: Multiple keywords, different categories**

```
Matches:
  - "aws" in title (cat_cloud_infra, tier 3)
  - "salesforce" in description (cat_crm, tier 2)
Calculation:
  Category 1: 4.0 × 1.5 = 6.0
  Category 2: 2.5 × 1.0 = 2.5
  Total: 6.0 + 2.5 = 8.5
Final Score: 9 (rounded)
```

**Example 4: With phrase boost**

```
Matches:
  - "aws" in title (tier 3)
  - "usd" phrase in description
Calculation:
  Category: 4.0 × 1.5 = 6.0
  Phrase: 1.5
  Total: 6.0 + 1.5 = 7.5
Final Score: 8 (rounded)
```

**Example 5: Negated hit excluded**

```
Text: "no aws experience required"
Matches:
  - "aws" in description (isNegated=true)
Active hits after negation gating: 0
Final Score: 0
```

**Example 6: Score clamping**

```
Matches: (hypothetical extreme case)
  - 3 tier-3 keywords in title (6.0 each, but max 1 per category)
  - Assume 3 different categories: 6.0 + 6.0 + 6.0 = 18.0
  - Raw score: 18.0
  - Clamped: 10.0
Final Score: 10
```

---

### **3.4 Top Category Selection**

**Algorithm:**

```typescript
categoryContributions.sort((a, b) => b.points - a.points);
topCategoryId = categoryContributions[0]?.categoryId ?? "";
```

**Tie-Breaker:**

- If multiple categories have same points: **first in sort order** (non-deterministic across categories, but deterministic given same input)
- Array is sorted by points descending
- If empty (no active hits): `topCategoryId = ""`

**Edge Cases:**

- No matches → `topCategoryId = ""`
- All negated → `topCategoryId = ""`
- Single category → `topCategoryId = <that category>`

---

### **3.5 ScoreResult Structure**

**Type:** `ScoreResult` (from `src/types/scoring.ts`)

```typescript
type ScoreResult = {
  score: number; // Final score (0-10 integer)
  topCategoryId: string; // Highest contributing category
  reasons: ScoreReason; // Detailed breakdown
};

type ScoreReason = {
  rawScore: number; // Before clamping
  finalScore: number; // After clamp & round
  categories: CategoryContribution[]; // Sorted by points desc
  phrases: PhraseContribution[];
  uniqueCategories: number;
  uniqueKeywords: number;
  negatedKeywordHits: number; // Audit trail
  negatedPhraseHits: number;
};
```

---

## 4. Test Vectors for Edge Cases

### **4.1 Token Boundary Cases**

| Test Name                | Input Text                | Expected Behavior                 | Rationale                         |
| ------------------------ | ------------------------- | --------------------------------- | --------------------------------- |
| `aws_exact_match`        | `"AWS engineer"`          | Match `"aws"`                     | Lowercase normalization           |
| `aws_vs_awesome`         | `"awesome engineer"`      | NO match for `"aws"`              | Token boundary: "awesome" ≠ "aws" |
| `aws_substring_in_word`  | `"awsome service"`        | NO match                          | Typo, not a token match           |
| `cpp_with_plus`          | `"C++ developer"`         | Match `"c++"`                     | Plus signs preserved in token     |
| `cpp_no_space`           | `"C++/Python"`            | Matches `"c++"` and `"python"`    | `/` is separator                  |
| `multi_token_google_ads` | `"Google Ads specialist"` | Match `["google", "ads"]`         | Consecutive token sequence        |
| `partial_multi_token`    | `"Google specialist"`     | NO match for "google ads"         | Incomplete sequence               |
| `hyphenated_full_stack`  | `"Full-Stack Developer"`  | Tokens: `["full", "stack"]`       | Hyphen is separator               |
| `underscore_var_names`   | `"python_developer"`      | Tokens: `["python", "developer"]` | Underscore is separator           |
| `comma_separation`       | `"AWS, GCP, Azure"`       | Match all three                   | Commas are separators             |

---

### **4.2 Negation Cases**

| Test Name                 | Input Text                                                                 | Matched Keyword | isNegated | Rationale                                                                |
| ------------------------- | -------------------------------------------------------------------------- | --------------- | --------- | ------------------------------------------------------------------------ |
| `no_aws_required`         | `"no AWS experience required"`                                             | `"aws"`         | `true`    | "no" within BEFORE window                                                |
| `sin_experiencia_aws`     | `"sin experiencia en AWS"`                                                 | `"aws"`         | `true`    | Spanish "sin" (without)                                                  |
| `not_aws`                 | `"not AWS"`                                                                | `"aws"`         | `true`    | English "not"                                                            |
| `without_aws`             | `"without AWS experience"`                                                 | `"aws"`         | `true`    | English "without"                                                        |
| `aws_not_azure`           | `"AWS not Azure"`                                                          | `"aws"`         | `true`    | "not" within AFTER window (2 tokens)                                     |
| `aws_not_azure_azure`     | `"AWS not Azure"`                                                          | `"azure"`       | `false`   | "not" is 1 token before, outside BEFORE window for "azure"               |
| `no_comma_aws`            | `"no, AWS is required"`                                                    | `"aws"`         | `true`    | Comma removed, "no" adjacent in tokens                                   |
| `no_or_aws`               | `"no AWS, GCP or Azure"`                                                   | `"aws"`         | `true`    | "no" within window                                                       |
| `no_or_aws_gcp`           | `"no AWS, GCP or Azure"`                                                   | `"gcp"`         | `true`    | "no" within 8-token window                                               |
| `no_or_aws_azure`         | `"no AWS, GCP or Azure"`                                                   | `"azure"`       | depends   | Distance: `"no"` at 0, `"azure"` at position — check if > 8 tokens apart |
| `aws_required_no_problem` | `"AWS required, no problem"`                                               | `"aws"`         | `false`   | "no" is 3 tokens after AWS (outside AFTER window)                        |
| `double_negative`         | `"not without AWS"`                                                        | `"aws"`         | `true`    | "without" is 1 token before, within window                               |
| `far_negation`            | `"no experience with Java Python Docker Kubernetes Terraform Ansible AWS"` | `"aws"`         | depends   | "no" at position 0, "aws" at position ~9+ (outside 8-token window)       |

---

### **4.3 Phrase Boost Cases**

| Test Name                       | Input Text                        | Phrases Matched                | Expected Boost | Rationale                       |
| ------------------------------- | --------------------------------- | ------------------------------ | -------------- | ------------------------------- |
| `phrase_usd_single`             | `"Salary in USD"`                 | `"usd"`                        | `+1.5`         | Single phrase boost             |
| `phrase_usd_multiple`           | `"USD USD USD"`                   | `"usd"`                        | `+1.5`         | Multiple occurrences count as 1 |
| `phrase_multidivisa`            | `"Soporte multidivisa"`           | `"multidivisa"`                | `+1.5`         | Spanish phrase                  |
| `phrase_international_payments` | `"pagos internacionales"`         | `["pagos", "internacionales"]` | `+1.5`         | Multi-token phrase              |
| `phrase_multiple_different`     | `"USD and pagos internacionales"` | 2 unique phrases               | `+3.0`         | Two distinct phrase boosts      |
| `phrase_negated`                | `"no USD required"`               | `"usd"` (negated)              | `0`            | Negated phrase contributes 0    |

---

### **4.4 Scoring Edge Cases**

| Test Name                  | Scenario                       | Expected Score    | Rationale                            |
| -------------------------- | ------------------------------ | ----------------- | ------------------------------------ |
| `no_matches`               | Empty text or no keywords      | `0`               | Baseline                             |
| `all_negated`              | All hits have `isNegated=true` | `0`               | Negation gating excludes all         |
| `single_tier3_title`       | `"AWS engineer"`               | `6`               | 4.0 × 1.5 = 6.0 → 6                  |
| `single_tier3_description` | `"Uses AWS"` in description    | `4`               | 4.0 × 1.0 = 4.0 → 4                  |
| `same_category_stacking`   | `"AWS EC2 S3"` (all kw_aws)    | `6`               | Max 1 per category, title field wins |
| `different_categories`     | `"AWS Salesforce"`             | `9`               | 6.0 + 2.5 = 8.5 → 9                  |
| `score_clamping_max`       | Hypothetical: raw score > 10   | `10`              | Clamped to MAX_SCORE                 |
| `score_rounding_up`        | Raw score 7.5                  | `8`               | Rounds to nearest integer            |
| `score_rounding_down`      | Raw score 7.4                  | `7`               | Rounds to nearest integer            |
| `phrase_only_no_keywords`  | Only phrase matches            | `score = 1.5 → 2` | Phrases contribute independently     |

---

### **4.5 Determinism Cases**

| Test Name                | Scenario                               | Expected Behavior                 | Rationale                                     |
| ------------------------ | -------------------------------------- | --------------------------------- | --------------------------------------------- |
| `same_input_same_output` | Run same offer twice                   | Identical `ScoreResult`           | Pure functions, no side effects               |
| `order_independence`     | `"AWS GCP"` vs `"GCP AWS"`             | Same score (6)                    | Both match, same category, max 1 per category |
| `empty_string_handling`  | `title=""`, `description=""`           | `score=0`, no errors              | Graceful degradation                          |
| `null_description`       | `title="AWS"`, `description=undefined` | `score=6`                         | Only title matched                            |
| `unicode_normalization`  | `"Café"` vs `"Cafe"`                   | Both match if keyword is `"cafe"` | Diacritic removal                             |

---

## 5. Structured Summary: How M3 Works

### **Input**

- `JobOfferDetail` with `title` (required) and `description` (optional)

### **Text Processing**

1. Normalize to tokens (lowercase, remove diacritics, split on separators)
2. Match keywords (consecutive token sequences)
3. Match phrases (consecutive token sequences)
4. Detect negation (window-based cue word search)

### **Scoring**

1. Filter out negated hits
2. Aggregate categories (max 1 per category, highest field weight)
3. Aggregate phrases (max 1 per phrase ID)
4. Sum: `rawScore = Σ(tier × field) + Σ(phrase boosts)`
5. Clamp to [0, 10] and round to integer

### **Output**

- `ScoreResult` with `score` (0-10), `topCategoryId`, and detailed `reasons`

### **Key Invariants**

- Same input → same output (deterministic)
- Negated hits contribute 0 points
- Max 1 hit per category per offer
- Max 1 count per phrase per offer
- Score always in range [0, 10]

---

## 6. Recommended Unit Tests (12–20 Tests)

### **Matcher Tests (8 tests)**

1. **`matcher_single_token_exact_match`**  
   Input: `"AWS engineer"` → Expect: match `"aws"`, not negated

2. **`matcher_token_boundary_aws_vs_awesome`**  
   Input: `"awesome engineer"` → Expect: NO match for `"aws"`

3. **`matcher_multi_token_consecutive_sequence`**  
   Input: `"Google Ads specialist"` → Expect: match `["google", "ads"]`

4. **`matcher_multi_token_partial_no_match`**  
   Input: `"Google specialist"` → Expect: NO match for "google ads"

5. **`matcher_separator_handling_hyphen_slash`**  
   Input: `"Full-Stack C++/Python"` → Expect: tokens `["full", "stack", "c++", "python"]`

6. **`matcher_phrase_boost_multi_token`**  
   Input: `"pagos internacionales required"` → Expect: phrase match `["pagos", "internacionales"]`

7. **`matcher_empty_input_graceful`**  
   Input: `title=""`, `description=""` → Expect: `keywordHits=[]`, `phraseHits=[]`, no errors

8. **`matcher_unicode_normalization`**  
   Input: `"Café José"` → Expect: tokens `["cafe", "jose"]`

---

### **Negation Tests (6 tests)**

9. **`negation_no_aws_required`**  
   Input: `"no AWS experience required"` → Expect: `"aws"` matched, `isNegated=true`

10. **`negation_sin_experiencia_spanish`**  
    Input: `"sin experiencia en AWS"` → Expect: `"aws"` matched, `isNegated=true`

11. **`negation_after_match_aws_not_azure`**  
    Input: `"AWS not Azure"` → Expect: `"aws"` negated (AFTER window), `"azure"` not negated

12. **`negation_comma_removed_no_aws`**  
    Input: `"no, AWS is required"` → Expect: `"aws"` negated (comma removed during tokenization)

13. **`negation_outside_window_far_keyword`**  
    Input: `"no experience with Java Python Docker Kubernetes Terraform Ansible AWS"` → Expect: `"aws"` NOT negated (outside 8-token window)

14. **`negation_no_cue_normal_match`**  
    Input: `"AWS experience required"` → Expect: `"aws"` matched, `isNegated=false`

---

### **Scorer Tests (6 tests)**

15. **`scorer_single_tier3_title`**  
    Input: Match `"aws"` in title → Expect: `score=6` (4.0 × 1.5)

16. **`scorer_same_category_no_stacking`**  
    Input: Match `"aws"` in title, `"ec2"` in description (same category) → Expect: `score=6` (max 1 per category, title wins)

17. **`scorer_different_categories_sum`**  
    Input: Match `"aws"` (tier 3) in title, `"salesforce"` (tier 2) in description → Expect: `score=9` (6.0 + 2.5 = 8.5 → 9)

18. **`scorer_phrase_boost_added`**  
    Input: Match `"aws"` in title + phrase `"usd"` → Expect: `score=8` (6.0 + 1.5 = 7.5 → 8)

19. **`scorer_all_negated_zero_score`**  
    Input: All hits have `isNegated=true` → Expect: `score=0`, `topCategoryId=""`

20. **`scorer_score_clamping_to_max`**  
    Input: Hypothetical raw score = 12.5 → Expect: `score=10` (clamped to MAX_SCORE)

---

### **Bonus: Integration Tests (2 tests)**

21. **`integration_full_pipeline_aws_in_title`**  
    Input: `JobOfferDetail` with `title="AWS Cloud Engineer"` → Expect: `MatchResult` with 1 keyword hit, `ScoreResult` with `score=6`

22. **`integration_negation_gating_no_aws`**  
    Input: `JobOfferDetail` with `description="no AWS experience"` → Expect: `MatchResult` with 1 hit (negated), `ScoreResult` with `score=0`

---

## 7. Constants and Tunables Identified

**Location:** `src/constants/`

| Constant                    | Value                             | File                   | Purpose                      |
| --------------------------- | --------------------------------- | ---------------------- | ---------------------------- | ------------------ |
| `TIER_WEIGHTS[3]`           | `4.0`                             | `scoring.ts`           | Tier 3 category points       |
| `TIER_WEIGHTS[2]`           | `2.5`                             | `scoring.ts`           | Tier 2 category points       |
| `TIER_WEIGHTS[1]`           | `1.0`                             | `scoring.ts`           | Tier 1 category points       |
| `FIELD_WEIGHTS.title`       | `1.5`                             | `scoring.ts`           | Title field multiplier       |
| `FIELD_WEIGHTS.description` | `1.0`                             | `scoring.ts`           | Description field multiplier |
| `PHRASE_BOOST_POINTS`       | `1.5`                             | `scoring.ts`           | Points per unique phrase     |
| `MAX_SCORE`                 | `10`                              | `scoring.ts`           | Score upper bound            |
| `MIN_SCORE`                 | `0`                               | `scoring.ts`           | Score lower bound            |
| `STRONG_THRESHOLD`          | `6`                               | `scoring.ts`           | M4 strong offer threshold    |
| `NEGATION_WINDOW_BEFORE`    | `8`                               | `negation.ts`          | Tokens to check before match |
| `NEGATION_WINDOW_AFTER`     | `2`                               | `negation.ts`          | Tokens to check after match  |
| `NEGATION_CUES`             | `["no", "sin", "not", "without"]` | `negation.ts`          | Negation trigger words       |
| `TOKEN_SEPARATOR_PATTERN`   | `/[\s\/\\                         | ()[\]{},;:.!?"'\-_]+/` | `textNormalization.ts`       | Tokenization regex |

**No Magic Numbers Found:** All numeric values are defined as named constants.

---

## 8. External Data Reliability Notes

**Missing/Empty Field Handling:**

| Field          | Behavior                                 | Code Location               |
| -------------- | ---------------------------------------- | --------------------------- |
| `title`        | Empty string → no matches, no errors     | `matcher.ts:196` (if guard) |
| `description`  | `undefined` → skipped gracefully         | `matcher.ts:206` (if guard) |
| `company.name` | **Intentionally excluded** from matching | `matcher.ts:220` (comment)  |

**Defensive Patterns:**

- Optional chaining: `offer.description?.` checks
- Conditional matching: `if (offer.title)` guards
- Empty token array handling: `tokens.filter(t => t.length > 0)`

**No Crashes on Malformed Input:**

- Empty strings produce empty token arrays → no matches
- Undefined fields are skipped
- Invalid UTF-8 handled by JavaScript string normalization

---

## 9. Logging

**Current Implementation:**

- Uses project logger: `import * as logger from "@/logger"`
- No `console.log()` calls found in matcher/scorer

**Logging Opportunities (not implemented):**

- Match count per field
- Negation hit counts
- Raw score before clamping
- Category contributions breakdown

**Note:** Logging is minimal; `ScoreResult.reasons` provides audit trail for debugging.

---

## Conclusion

M3 signal processing is a **deterministic, pure pipeline** with clear separation of concerns:

- **Matcher:** Detects keyword/phrase hits with token-boundary matching and inline negation annotation
- **Scorer:** Aggregates hits with category max-1 rule, applies tier/field weights, clamps to [0-10]

All tunables are in `src/constants/`, no magic numbers in logic. Edge cases are handled gracefully (empty strings, undefined fields, negation window boundaries). The implementation is ready for comprehensive unit testing with the 20 test cases identified above.

**Key Testing Priorities:**

1. Token boundary enforcement (no substring matching)
2. Negation detection (window boundaries, edge cases)
3. Scoring aggregation (max 1 per category, phrase independence)
4. Score clamping and determinism
