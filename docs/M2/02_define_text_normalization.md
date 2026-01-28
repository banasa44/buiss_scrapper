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

The goal is to:

- Maximize recall
- Reduce trivial noise
- Keep behavior deterministic and explainable

---

## Keyword Matching Rules

Matching supports:

- Exact keyword matches
- Defined synonyms
- Simple regex patterns

All matches are **rule-based**.

No semantic embeddings or LLM-based matching in M1.

---

## Context Handling (Negations)

Basic negation handling is enabled to reduce obvious false positives.

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

- All text fields are treated equally
- No weighting between title / description / company name in M1

> Simplicity over premature optimization.

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
