# TASK 3 — Scoring & Lead Prioritization (USD / FX Signal)

## Goal

Convert detected keyword matches into an **actionable, ranked company list** for a Revolut seller:

- A single numeric score per company (sortable)
- A lightweight classification label (A/B) for quick filtering
- Minimal assumptions and no hard exclusions beyond “score = 0”

This is a **ranking system**, not an outreach decision engine.

---

## Score Scale

- Use a **0–10 integer scale**.
- Internally we can compute raw points, then **clamp/normalize** to 0–10 to keep output stable.

> Rationale: easy to interpret and compare, without overfitting.

---

## What Contributes to the Score

### Category-based scoring (primary)

Score is primarily driven by **unique categories matched** (not raw keyword count).

- Each category has a weight tier:
  - Tier 3: “USD almost certain” (Ads, Cloud, Global Payments)
  - Tier 2: “USD likely” (CRM, Data/Analytics, Dev/Product tooling)
  - Tier 1: “International context only” (Design, Collaboration, Ecommerce)

Rule:

- **Only one hit per category counts** (avoid spam from repeated terms).

### Keyword-level contributions (secondary)

Certain keywords are treated as “special” within a category:

- They may influence the category tier or contribute a small extra bump.

> Keeps flexibility without losing explainability.

---

## Repetition Handling

Default rule (M2-safe, simple):

- Repeated keywords inside the same category do **not** stack.
- Optional “diminishing returns” can be added later if we see under-scoring in real data.

> For M1/M2 start: keep it strict to avoid noise inflation.

---

## Phrase Boosts

Phrase-level signals (e.g. “USD”, “multidivisa”, “pagos internacionales”) add a **strong bonus**:

- They **increase the score**, but do not automatically max it.

> This prevents single-phrase false positives from dominating.

---

## Output Semantics

### Interpretation

- Score represents a **priority level** (ranking).
- The system does **not** decide “contact vs not contact”.
- Everything with score > 0 is included and sortable.

### Output fields (minimum)

Per company:

- `company_id` / canonical company name
- `score` (0–10)
- `label` (A/B) — quick filter
- `top_category` (the strongest matched category)

> Start with `B` output (score + dominant category).
> If needed later, we can add full “reasons list” without changing scoring.

---

## Filtering Policy

- Only exclude `score = 0`.
- No automatic “company size” filtering in this milestone.

Rationale:

- Company “size” is hard to infer reliably from job posts.
- Even small teams can have high FX volume.
- Avoid brittle heuristics and false exclusions.

---

## Non-goals

- No CRM integration
- No outreach logic
- No company-size inference heuristics
- No ML model in this task
- No hard thresholds besides score > 0 inclusion

---

## Notes / Future Hooks

- Keep a stable category catalog and tier weights so we can iterate safely.
- Allow re-weighting via constants, not hardcoded values.
- If later we want better explainability, add an optional `reasons[]` output (keywords/categories matched).
