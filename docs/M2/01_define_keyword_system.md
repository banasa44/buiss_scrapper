# TASK 1 — Keyword System (Signal Detection for USD / FX Exposure)

## Goal

Detect **Spanish companies** with a **probable and meaningful exposure to USD / foreign currency operations**, using job postings as a **signal**, not as a lead source.

The objective is **signal quality over volume**:

> Fewer false positives, even if that means accepting some noise with low scores.

The system **does not contact anyone**.  
It only identifies and ranks companies.

---

## Target Companies

### Included

- Spanish companies with:
  - SaaS / software products
  - Global infrastructure usage
  - International payments or billing
  - US or international customer base
- Medium-sized companies are preferred, but:
  - Consultancies / agencies **may be included** **only if the USD signal is very strong**

### Excluded

- Freelancers / autónomos (always excluded)
- Individuals
- Personal profiles

---

## Keyword Philosophy

Keywords are not “popular tech terms”.  
They must indicate **real or likely USD / FX pain**.

A keyword is valid if it maps to **at least one** of:

- US-based SaaS
- Global cloud infrastructure
- International ads platforms
- International payments / finance tools
- Recurring licenses billed in foreign currency

---

## Keyword Categories

### Level 1 — Strong USD Signal

High confidence of USD exposure.

Examples:

- Ads platforms (Google Ads, Meta Ads, TikTok Ads)
- Cloud infrastructure (AWS, GCP, Azure)
- Global payments (Stripe, Adyen, PayPal, Wise)

### Level 2 — High Probability USD

Likely USD exposure, but indirect.

Examples:

- CRM / Marketing Automation
- Data / Analytics platforms
- Dev / Product tooling

### Level 3 — Contextual / Complementary

Do **not** generate leads alone.  
Only reinforce existing signals.

Examples:

- Design tools
- Collaboration / productivity tools
- Ecommerce / marketplaces

---

## Phrase-Based Boosts

Certain **explicit phrases** provide a **strong boost**, but never guarantee a lead alone:

Examples:

- “USD”, “dólares”
- “multidivisa”
- “pagos internacionales”
- “facturación internacional”
- “clientes internacionales”
- “mercado US”
- “SaaS”

---

## Scoring Principles (High-Level)

- Scoring is **aggressive** by design:
  - Even low scores are kept
  - The client will filter later
- Score is based on:
  - **Unique categories matched** (not raw keyword count)
  - Phrase-based boosts

Rules:

- Multiple keywords in the **same category do not stack**
- More categories → higher confidence
- Explicit USD / FX phrases → strong boost

---

## Lead Inclusion Rules

- A company **enters the output even with score = 1**
- Companies with weak or ambiguous signals:
  - Are included with **low score**
  - Can be filtered out later by the client
- No company is excluded solely due to low confidence

---

## Output (from this task)

For each company:

- Company name
- Final numeric score
- Optional classification label (e.g. A / B)
- No keyword breakdown required (score-only view)

---

## Non-Goals

- No contact enrichment
- No people data
- No lead assignment
- No outreach logic
- No ML model in M1 (rule-based only)

---

## Summary

This task defines a **signal detection system**, not a sales funnel.

It intentionally favors:

- Recall over precision
- Transparency over complexity
- Post-filtering by the client over hard exclusions
