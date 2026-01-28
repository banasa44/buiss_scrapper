# TASK 2 — Text Normalization & Keyword Extraction

## Goal

Transform raw job offers into **clean, normalized textual inputs** suitable for
reliable keyword matching and scoring, while keeping the system **simple, robust,
and legally safe**.

This task prepares the data for **TASK 3 (Scoring)**.
No decisions are taken here — only extraction and normalization.

---

## Input Sources

### Accepted Sources

- Public job offers only (InfoJobs, Indeed, Glassdoor, similar)
- One offer = one analysis unit

### Fields Used for Matching

Keyword matching is performed over:

- Job title
- Job description
- Company name

> Rationale: company name often contains strong SaaS / platform signals.

---

## Supported Languages (M1)

- Spanish (ES)
- English (EN)

Language detection is used **only to adapt normalization**,  
not to change scoring logic.

---

## Text Normalization Strategy

### Level: **Aggressive but standard (Recommended)**

The system applies well-known, low-risk NLP preprocessing:

- Lowercasing
- Trimming and whitespace normalization
- Accent / diacritic removal
- Punctuation and symbol cleanup
- Stopword removal (language-aware)
- Lemmatization / stemming (lightweight, standard libraries)

> No custom ML, embeddings, or heavy NLP in M1.

### Tokenization Rules

Tokens are split on:

- Whitespace
- Punctuation
- Technical separators (`/`, `\`, `-`, `_`, `.`, `:`, `@`)

Tokenization is:

- **Deterministic** (same input always produces same output)
- **Language-agnostic** (consistent behavior across ES/EN)

### Normalization Pipeline

The **same normalization pipeline** is applied to:

- Input text (job offers)
- Keyword catalog

This ensures consistent matching behavior.

The goal is to:

- Maximize recall
- Reduce trivial noise
- Keep behavior deterministic and explainable

---

## Keyword Matching Rules

### Word Boundaries

All keyword matches must respect **token boundaries**:

- Substring matches are **not allowed**
- Example: `aws` will not match `awesome`
- Ensures precision and reduces false positives

### Multi-Word Phrases

Phrase matching requires:

- **Exact consecutive token matches** after normalization
- No gaps or reordering allowed
- Matching is performed on normalized and tokenized text

### Synonyms

Matching supports:

- Exact keyword matches
- Defined synonyms (treated as aliases)
- Simple regex patterns

All matches are **rule-based**.

No semantic embeddings or LLM-based matching in M1.

---

## Excluded Content

### URLs and Email Addresses

- URLs and email addresses are **ignored** for keyword and phrase matching
- No hostname or domain-based matching in M1/M2
- Rationale: reduces noise and avoids false positives from common tech domains

---

## Context Handling (Negations)

Basic negation handling is enabled to reduce obvious false positives.

### Negation Semantics

If a keyword appears within a negated context:

- The hit does **not** count as a positive match
- A **small negative adjustment** (penalty) is applied, not hard exclusion
- The penalty affects the score but does not zero it out

### Negation Scope

- Negation is detected using a **sliding window** of **6–10 tokens** around the keyword
- Negation patterns include:
  - "no experience with X"
  - "without X responsibility"
  - "not required: X"

Examples:

- “no experience with AWS required”
- “without Google Ads responsibility”

This is implemented as:

- Simple negation patterns
- Limited scope (local context only)

> This is intentionally **basic**, not perfect.
> Complex semantic negation is deferred to M2.

---

## Matching Scope

- All text fields (title, description, company name) are analyzed
- Matches are **aggregated per job offer**, not per field
- Category hit limits apply **once per offer** (not once per field)
- Field-level information is preserved for weighting in the scoring layer

---

## Persistence & Storage

- Normalized text is **not persisted**
- Only derived signals (scores, classifications) are kept

> Raw and normalized text remain ephemeral during ingestion.

---

## Explicit Non-Goals

- No personal data handling
- No LinkedIn or private sources
- No recruiter or candidate data
- No outreach logic
- No ML / AI models in M1
- No long-term text storage

---

## Summary

This task ensures that:

- Keyword detection is reliable and repeatable
- Text noise is minimized
- The system stays simple, fast, and explainable

All **business decisions happen later**, in the scoring layer.
