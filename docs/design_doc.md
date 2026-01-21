# Design Document — InfoJobs “FX/USD Signal Collector” (Spec v1)

## 1) System goal and value criterion

This project exists to generate a prioritized list of Spanish companies with a high likelihood of foreign-currency friction (recurring USD payments, international SaaS spend, global cloud and marketing stacks). The primary signal is not “industry” or “company size”, but what companies _declare_ in public job postings: tools, platforms, and phrases that strongly correlate with international subscription billing and cross-border payments.

The output must be actionable for a sales rep: a ranked table of companies with a score and explainable “reasons” (which technologies/keywords triggered the score), plus traceability back to the specific job postings that generated the signal. The system **identifies** potential leads; it does not contact anyone or extract personal profiles.

## 2) Technical-legal framing and data constraints

The system operates only on public job postings and stores only job/company data: company name, job title, job description, location, date, URL, and detected technologies/keywords. It must **not** store any personal data related to candidates or recruiters.

From a robustness and compliance perspective, the design follows a simple rule: **prefer official APIs** when available. InfoJobs provides a documented REST API that supports offer search/listing and offer detail retrieval, which is a cleaner and more maintainable foundation than HTML scraping.

## 3) Architectural overview

The architecture is a deterministic pipeline with a single primary source (InfoJobs), a keyword + scoring engine, a database as the system of record (SSOT), and a Google Sheets exporter as a human-friendly “view” for the client.

At a high level: **search offers → dedupe & persist → analyze text & detect signals → aggregate per company → export to Sheets**. Everything valuable for long-term operation (offers, matches, scores) is stored in the DB; Google Sheets is consumption and sorting, not a reliable store.

## 4) Data source: InfoJobs API and its role

### 4.1 Authentication and access

InfoJobs requires developer/app authentication for API access. The application must be registered and requests must include the appropriate credentials/tokens. This matters because the system should not rely on browser sessions or UI automation; it should be API-first and maintainable.

### 4.2 Operations the system needs

The system needs two core capabilities:

1. **List/search job offers** by query parameters (keywords, Spain location filters, etc.). The API provides an offers listing endpoint that supports search parameters and pagination/limits.

2. **Fetch offer detail** for a specific offer ID to obtain richer fields, including a public URL link and the full description when needed.

The design assumes listing results can be partial and the detail endpoint is used for high-quality text extraction and traceable URLs.

### 4.3 Crawling strategy (non-aggressive)

Execution is batch-based once or twice per day. The connector applies pagination and reasonable per-query caps to avoid unnecessary volume. The goal is not “crawl all Spain every run” but to process new deltas since the last run.

## 5) Functional configuration: queries, keyword catalog, and scoring

### 5.1 Queries (“what we search for”)

A “query” is a unit of search against InfoJobs. Queries are used to segment the problem into coherent blocks: e.g., “Ads & Growth”, “Cloud & Infra”, “Payments”, etc. Each query has a tag and search parameters (primary keywords, Spain scope, and any useful filters).

The design assumes a small number of stable queries (2–10) to keep auditing simple: when a company appears at the top, we must be able to explain which query it matched and why.

### 5.2 Keyword catalog (the differentiator)

The catalog is not a flat list. It is a set of terms grouped into categories that correlate with recurring international spend: Ads (Meta/Google/TikTok), Cloud (AWS/GCP/Azure), Payments (Stripe/Adyen/Checkout), CRM/Support (Salesforce/HubSpot/Zendesk), Data (Snowflake/Datadog), Dev/Product (GitHub/Jira/Atlassian), and so on.

The catalog also includes “phrase keywords” that act as accelerators (“USD”, “multicurrency”, “international payments”, etc.). These phrases do not identify software, but strongly suggest international context.

Operationally, the catalog is a versioned configuration file. This allows iteration every 2–3 weeks (adding synonyms, tuning exclusions, adjusting weights) without code changes.

### 5.3 Scoring model (simple, powerful, controlled)

Scoring is defined by **per-keyword weights** (e.g., 3/2/1) and aggregated at company level. A key rule to reduce noise is that scoring should **not grow unbounded within the same category**: many Ads keywords should not inflate the score indefinitely. Instead, cross-category combinations (Ads + Cloud + Payments) should be rewarded as stronger signals.

This yields an explainable company score: “high because Ads (3), Cloud (3), CRM (2), plus phrase ‘USD’ (+boost)”. Explainability is a product requirement because sales reps need clear reasons.

## 6) Data model and persistence (DB as SSOT)

A database is necessary because the project must accumulate evidence, avoid duplicates, and minimize false positives. Storing only a link is fragile (postings expire or change). Therefore, the system stores a minimal snapshot of the posting text and the matching outcome.

The conceptual model has three parts:

### 6.1 Companies

Represents a company as an aggregated entity. The functional key is `companyKey`, derived from a normalized company name. Initially, since InfoJobs may not provide a consistent global company identifier, normalized name is a reasonable starting point. Company rows store aggregates: first seen, last seen, total score, accumulated categories/keywords, and number of matched offers.

### 6.2 Job posts (offers)

Each job offer is stored as an immutable or mostly-immutable entry with a unique identifier. Preferred uniqueness uses the source offer ID; otherwise, canonical URL can be a fallback. The InfoJobs offer detail includes a public `link` field which is persisted for traceability.

In addition, the system stores the description (or a minimal snippet), plus metadata (title, location, dates). Optionally, the system stores a text hash to detect “reposts” with different IDs but identical or near-identical content.

### 6.3 Matches (signal evidence)

For each offer, the system persists the matched keywords/phrases, the computed score, and the “reasons” (e.g., “matched Meta Ads + AWS + USD phrase”). This can be a separate table or embedded into job_posts for MVP; the key requirement is that the system can always answer: “why is this company here, and which offers prove it?”

## 7) Ingestion and deduplication: keeping the system consistent

When new offers are processed, the system follows a consistent sequence:

1. Resolve company (upsert into `companies` via `companyKey`).
2. Resolve offer (upsert into `job_posts` via `sourceOfferId` or canonical URL).
3. If the offer already exists, it is not counted as “new”; the system may refresh selected fields if needed, or leave it unchanged.
4. Run matcher and persist the result.
5. Recompute or update company aggregates.

For MVP simplicity and safety, company aggregates can be recomputed from stored matched offers rather than maintained incrementally. This makes the system easier to reason about and avoids subtle incremental bugs.

This design ensures two essential properties: idempotency (safe reruns) and traceability (auditable reasons).

## 8) Text processing and matching engine: behavior and failure modes

The matching engine receives text (title + description) and applies minimal preparation (lowercasing, whitespace normalization, basic variant handling). This is not a large “normalizer”; it is just enough to ensure that formatting differences do not break matching.

Matching combines three strategies: phrase matches (for sensitive tokens like “USD”), exact keyword matches (tool names), and synonyms/aliases (“GCP” vs “Google Cloud”). It also supports simple exclusions once real false positives are observed.

Failure modes are mostly quality-related: false positives (keyword appears in irrelevant context) and false negatives (tool name written in an unexpected variant). These are addressed by improving catalog rules—not by more crawling. This is why the catalog must be configurable and versioned.

## 9) Company aggregation: turning postings into leads

A company becomes a “candidate” when it has one or more postings above a minimum score threshold or when it accumulates strong cross-category signals. The aggregator computes:

- Company score (category-capped + boosts)
- Number of matched offers
- Accumulated categories/keywords
- Evidence offer URLs (all URLs, or a sample + count)

This aggregation is what makes the output actionable: two companies may mention the same tool, but only one shows the multi-category pattern that implies recurring USD spend.

## 10) Google Sheets export: a sales-friendly view

The exporter reads from the DB and writes a sortable table. Google Sheets is ideal for sales operations, but it has quotas and performance limits, so exports should be done in batches and avoid overly granular per-cell updates.

In MVP, the primary sheet contains one row per company with: name, score, categories/keywords, matched offers count, and evidence URLs. If the evidence URL column grows too large, the natural evolution is a second sheet “Offers” with one row per offer; the DB model already supports this from day one.

## 11) Orchestration: runner, scheduling, and state

The runner is the single entry point. It loads configuration, executes queries sequentially, and uses state to reduce reprocessing. The minimal state is `lastRunAt` per query; if the API does not support “since” filters, the runner filters client-side by dates or by checking existing DB entries.

Scheduling is typically daily (or twice daily) via cron or an equivalent scheduler. Behavior is the same in all environments: batch execution with a clear summary at the end.

## 12) Resilience: errors, retries, and graceful degradation

Expected failures include network timeouts, API errors, and temporary rate limits. The system should continue when a single offer fails, but fail fast when configuration or authentication is invalid.

Retries must be conservative: bounded attempts with backoff to avoid loops. When an offer cannot be retrieved, the system logs the error and continues; when a query fails completely, it is logged and can be retried in a later run.

## 13) Observability: what must be visible without debugging

Each run must produce a clear summary: offers found per query, new vs duplicate offers, matches, newly identified companies, updated companies, and error counts by type. This is required to operate the system as the keyword catalog evolves and to answer client questions like “why did this company move up/down?”

## 14) Minimal testing that ensures real quality

The system’s value is primarily in matching and aggregation, not in the connector. Therefore, minimal tests focus on:

- Unit tests for matcher (phrases, synonyms, exclusions)
- Dedupe + idempotency tests (rerun does not duplicate offers/companies)
- Live integration test (gated) to validate InfoJobs API and Sheets export with minimal volume

## 15) Security and secret management

InfoJobs and Google credentials must be managed as secrets (environment variables or a secret manager) and never committed. The SQLite DB stores company and job offer business data and should be treated accordingly: controlled access and backups if running on a server.

## 16) Planned evolution without breaking the architecture

The design supports three natural expansions:

1. Adding additional sources (Indeed/Glassdoor or company careers pages) as parallel connectors, because the rest of the pipeline remains the same (all produce a normalized `JobPosting` contract).

2. Improving scoring (category caps, contextual boosts, lightweight NLP) without changing the DB model; only the scoring engine and reasons computation change.

3. Adding company enrichment (e.g., filtering by revenue < €20M) as a separate stage once the client decides it is a hard requirement. This enrichment should be modular to avoid coupling the MVP to external providers.
