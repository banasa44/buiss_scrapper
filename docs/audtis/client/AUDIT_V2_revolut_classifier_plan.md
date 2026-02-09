# Scoring System V2 Plan: Revolut-Optimal Classifier

## 1) Executive Summary
V2 should shift scoring from generic "modern SaaS stack" detection to explicit FX and cross-border money-flow detection. The classifier should treat direct FX exposure as required evidence for top ranking, and treat Stripe/Adyen/cloud/ads as supporting context only.

Expected effect:
- Precision up at the top of the ranked list by gating strong scores behind real FX indicators.
- Recall up for non-tech companies (import/export, logistics, tourism, finance ops) that currently under-score.
- Explainability retained by preserving deterministic matching, explicit weights, and reason traces per offer.

What stays the same:
- Deterministic rule-based pipeline (`catalog -> matcher -> scorer -> aggregation -> sheets`).
- Human review workflow in Google Sheets.
- No ML training dependency.

### Grounding
- Files consulted: `docs/audtis/client/AUDIT_FINAL_scoring_system.md`, `docs/audtis/client/AUDIT_02_matching_scoring_technical.md`, `src/ingestion/ingestOffers.ts`, `src/signal/matcher/matcher.ts`, `src/signal/scorer/scorer.ts`, `src/sheets/companyRowMapper.ts`.
- Observed behavior: `ingestOffers()` calls `matchOffer()` then `scoreOffer()` and persists JSON to `matches.matched_keywords_json`.
- Observed behavior: scoring is deterministic and explainable via `ScoreResult.reasons`.
- Observed behavior: Sheets output is company-level, 10 columns A-J, and currently metric updates only touch D-J.

## 2) Gap Analysis vs V1 (Grounded in code + audits)
What V1 captures well:
- Deterministic exact token matching with negation handling.
- Strong reproducibility and auditability of offer-level score breakdown.
- Stable aggregation and export contract.

Where V1 over-classifies (false positives):
- Catalog is dominated by tech proxies (`aws`, `google ads`, `stripe`, `hubspot`) in `data/catalog.json`.
- Single tier-3 tech-category hit in title can immediately produce "strong" signals due current weight geometry (`TIER_WEIGHTS[3] * FIELD_WEIGHTS.title = 6.0`).
- URL tokens can trigger matches (for example `stripe.com`) because URL text is tokenized and matched as normal text.

Where V1 under-classifies (false negatives):
- Non-tech FX operations language is underrepresented (treasury, AR/AP, suppliers abroad, import/export, currency settlement language).
- Phrase tier is ignored (`phrases[].tier` does not affect points), so high-value FX phrases are underweighted relative to tech category hits.
- Company-name signals are fully disabled, which removes some high-signal entities in trade/logistics naming.

Code-level limitations to explicitly address:
- Matching is exact token sequence only in `matchField()` and `matchPhrases()` in `src/signal/matcher/matcher.ts`; no safe pattern layer for currencies/symbols/pairs.
- Negation cues are only `no`, `sin`, `not`, `without` in `src/constants/negation.ts`.
- Phrase scoring is fixed by `PHRASE_BOOST_POINTS` in `src/constants/scoring.ts`; phrase tier is validated but ignored in `src/signal/scorer/scorer.ts`.
- Aggregation uses only offer `topCategoryId` parsed by `parseTopCategoryId()` in `src/db/repos/offersRepo.ts`; `category_max_scores` does not represent full per-offer category evidence.

### Grounding
- Files consulted: `data/catalog.json`, `src/constants/scoring.ts`, `src/signal/scorer/scorer.ts`, `src/constants/negation.ts`, `src/signal/matcher/matcher.ts`, `src/db/repos/offersRepo.ts`, `docs/audtis/client/AUDIT_01_catalog_analysis.md`, `docs/audtis/client/AUDIT_03_company_aggregation.md`.
- Observed behavior: `PHRASE_BOOST_POINTS` is a fixed constant; phrase tier is not used for scoring.
- Observed behavior: company name matching is explicitly disabled in `matchOffer()`.
- Observed behavior: aggregation parses only `topCategoryId` from `matched_keywords_json`.

## 3) V2 Signal Model (Features)
### A. Direct FX Exposure Signals (highest value)
- Scoring intent: primary determinant of "Revolut fit"; highest contribution and required for top scores.
- Example signals (ES/EN): `usd`, `eur`, `gbp`, `mxn`, `chf`, `divisa`, `multidivisa`, `fx`, `foreign exchange`, `tipo de cambio`, `cobros en divisa`, `pagos a proveedores internacionales`, `facturacion internacional`, `accounts payable`, `accounts receivable`, `invoice in USD`, `salary in USD`.
- Expected false positives: isolated mentions in legal boilerplate or benefits text.
- Mitigations: require either multiple direct FX concepts or direct FX plus footprint/business corroboration for high scores.

### B. International Footprint Signals (medium-high)
- Scoring intent: supporting evidence that operations are cross-border and likely multi-currency.
- Example signals (ES/EN): `clientes en UK`, `US market`, `LATAM`, `EMEA`, `APAC`, `global clients`, `operacion internacional`, `expansion internacional`, `international customers`, language requirements tied to sales/procurement (`ingles para trato con clientes/proveedores`).
- Expected false positives: generic "English required" for local-only roles.
- Mitigations: only score these strongly when paired with commerce/finance nouns (clients, suppliers, billing, payments, procurement).

### C. Business Model / Sector Signals (medium)
- Scoring intent: broaden recall for non-tech verticals with real FX needs.
- Example signals (ES/EN): `importacion`, `exportacion`, `logistica internacional`, `freight forwarding`, `turismo`, `agencia de viajes`, `marketplace`, `ecommerce internacional`, `distribuidor`, `mayorista`, `proveedores internacionales`, `tesoreria`, `conciliacion bancaria`, `reconciliation`.
- Expected false positives: domestic logistics or domestic ecommerce.
- Mitigations: cap this bucket and require direct FX or international corroboration for strong classification.

### D. Tech Proxy Signals (low-medium, downweighted)
- Scoring intent: supplementary only; never enough for high ranking on their own.
- Example signals (ES/EN): `stripe`, `adyen`, `paypal`, `braintree`, cloud and ad stack terms.
- Expected false positives: local SaaS teams using payment providers but no FX exposure.
- Mitigations: strict bucket cap and "no direct FX cap" on final score.

### Grounding
- Files consulted: `data/catalog.json`, `src/signal/matcher/matcher.ts`, `src/signal/scorer/scorer.ts`, `docs/audtis/client/AUDIT_01_catalog_analysis.md`, `docs/audtis/client/AUDIT_FINAL_scoring_system.md`.
- Observed behavior: current catalog categories are mostly proxy-tech (cloud/ads/payments/crm/analytics/collaboration).
- Observed behavior: current scorer treats category points as dominant and does not require direct FX evidence.
- Observed behavior: phrases and keywords are currently independent hits with no bucket-level gating.

## 4) Catalog V2 Design
Proposed category set (tiered, aligned to Revolut need):

| Category ID | Bucket | Tier | Intent |
| --- | --- | --- | --- |
| `cat_fx_currency_ops` | direct_fx | 3 | explicit currency, FX, multi-currency ops |
| `cat_fx_crossborder_payments` | direct_fx | 3 | international payables/receivables and settlement |
| `cat_fx_trade_ops` | direct_fx | 3 | import/export and suppliers abroad |
| `cat_fx_foreign_compensation` | direct_fx | 3 | payroll/comp in foreign currency |
| `cat_intl_market_presence` | intl_footprint | 2 | active markets and customer geographies |
| `cat_intl_multilingual_commercial` | intl_footprint | 2 | language tied to trade/sales/procurement |
| `cat_biz_finance_ops` | business_model | 2 | treasury, AP/AR, reconciliation, invoicing ops |
| `cat_biz_logistics_trade` | business_model | 2 | logistics, freight, customs, forwarding |
| `cat_biz_travel_tourism` | business_model | 2 | travel/tourism with cross-border payments |
| `cat_biz_ecommerce_marketplace` | business_model | 2 | ecommerce/marketplace with cross-border motion |
| `cat_proxy_payment_stack` | tech_proxy | 1 | stripe/adyen/paypal |
| `cat_proxy_growth_stack` | tech_proxy | 1 | ads/crm/analytics stack |
| `cat_proxy_cloud_stack` | tech_proxy | 1 | cloud infra stack |

Keyword and phrase expansion examples to add (ES + EN):
- Direct FX: `tipo de cambio`, `cambio de divisa`, `cobros en divisa`, `pagos en usd`, `settlement in eur`, `foreign exchange`, `fx hedging` (if relevant), `transferencias internacionales`.
- Footprint: `clientes internacionales`, `mercado usa`, `clientes uk`, `operacion en latam`, `emea`, `apac`.
- Business: `cuentas a pagar`, `cuentas a cobrar`, `conciliacion`, `tesoreria`, `import export`, `incoterms`, `aduanas`, `proveedores internacionales`.
- Tech proxy (downweighted): `stripe`, `adyen`, `paypal`, `braintree`, old cloud/ads terms.

Add explicit negative/exclusion concepts:
- `solo mercado nacional`, `solo espana`, `sin pagos internacionales`, `no operaciones internacionales`, `domestic only`, `no english required for clients`, `sin trato con proveedores internacionales`.

Proposed V2 schema (additive, backward compatible):

```ts
type CatalogRawV2 = {
  version: string;
  categories: Array<{
    id: string;
    name: string;
    tier: 1 | 2 | 3;
    bucket?: "direct_fx" | "intl_footprint" | "business_model" | "tech_proxy";
    enabled?: boolean; // default true
  }>;
  keywords: Array<{
    id: string;
    categoryId: string;
    canonical: string;
    aliases: string[];
    weight?: number; // default 1.0
    enabled?: boolean; // default true
  }>;
  phrases: Array<{
    id: string;
    phrase: string;
    tier: 1 | 2 | 3;
    categoryId?: string; // optional link to category/bucket
    weight?: number; // overrides tier-derived phrase weight
    enabled?: boolean; // default true
  }>;
  negatives?: Array<{
    id: string;
    aliases: string[];
    penalty: number; // positive value, scorer subtracts it
    hardExclude?: boolean; // default false
    enabled?: boolean; // default true
  }>;
};
```

Backward compatibility and migration:
- Keep existing V1 fields valid. Missing V2 fields get defaults in loader (`enabled=true`, `weight=1`, `bucket` inferred by category ID map).
- Move to `version: "2.x.x"` in `data/catalog.json`, but allow loader to parse `1.x.x` for rollback.
- Validation additions: check optional fields when present, verify `categoryId` references, verify `penalty > 0`.

Loader/validation updates required:
- `validateCatalogRaw()` in `src/utils/catalogValidation.ts`: validate optional V2 properties.
- `compileCatalog()` in `src/catalog/loader.ts`: ignore disabled entries, carry weights/buckets/negative concepts to runtime.
- `src/types/catalog.ts`: extend runtime types for weights, bucket, enabled, negatives.

### Grounding
- Files consulted: `data/catalog.json`, `src/types/catalog.ts`, `src/utils/catalogValidation.ts`, `src/catalog/loader.ts`, `docs/audtis/client/AUDIT_01_catalog_analysis.md`.
- Observed behavior: current schema has no enabled flags, no per-keyword or per-phrase weight, no negative concepts.
- Observed behavior: loader already compiles aliases/phrases and is the right insertion point for additive V2 fields.
- Observed behavior: validation is fail-fast and already enforces referential integrity, so V2 checks fit the same pattern.

## 5) Scoring V2 Formula (Offer-Level)
Proposed deterministic formula (0-10, one decimal):

1. Build active hits: exclude negated keyword/phrase/pattern hits.
2. Compute concept points:
`conceptPoints = conceptWeight * fieldMultiplier`.
3. Deduplicate per concept ID: keep max points for same concept.
4. Sum by bucket with caps:
- `direct_fx` cap 7.0
- `intl_footprint` cap 3.0
- `business_model` cap 2.5
- `tech_proxy` cap 1.5
5. Add synergy:
- `+1.0` if `direct_fx >= 2.5` and `intl_footprint >= 1.0`
- `+0.8` if `direct_fx >= 2.5` and `business_model >= 1.0`
- `+0.5` for 2 unique currency codes, `+1.0` for 3+ unique currency codes (cap 1.0 total)
6. Subtract penalties from matched negatives (and apply hard exclude when configured).
7. Apply no-FX guard: if `direct_fx < 2.0`, cap final score at `5.0`.
8. Final score:
`score = clamp(round(raw * 10) / 10, 0, 10)`.

Recommended constants:
- `fieldMultiplier = { title: 1.25, description: 1.0, company: 0.35 }`
- `phraseTierBase = { 3: 2.0, 2: 1.2, 1: 0.6 }` (fixes the current phrase-tier ignored issue)
- `strong threshold` stays `6.0` for continuity; new `fxCore` boolean should gate FX-focused ranking.

Numeric examples:

Example 1 (true FX target):
- Hits: `usd` (2.0), `pagos internacionales` (2.0), `proveedores internacionales` (1.5), `clientes UK` (1.0), `accounts payable` (1.0), `stripe` (0.8).
- Bucket sums: direct_fx `5.5`, intl `1.0`, business `1.0`, tech `0.8`.
- Synergy: `+1.0` (fx+intl) + `+0.8` (fx+business).
- Raw: `5.5 + 1.0 + 1.0 + 0.8 + 1.8 = 10.1`, final `10.0`.

Example 2 (tech-only false positive candidate):
- Hits: `aws` title (1.0), `stripe` (0.8), `hubspot` (0.6).
- Bucket sums before cap: tech `2.4`, after cap `1.5`.
- No direct FX, no international, no business.
- No-FX guard applies: score remains low (`<= 1.5`, optionally minus additional proxy-only penalty if configured).

Example 3 (medium signal, not strong):
- Hits: `usd` (2.0), `clientes LATAM` (1.0), `paypal` (0.8).
- Bucket sums: direct_fx `2.0`, intl `1.0`, tech `0.8`.
- No-FX guard edge case: direct_fx is minimal, score stays moderate.
- Raw approx: `3.8` to `4.8` (depending on synergy threshold), below strong.

Negation handling in V2 scoring:
- Keep current behavior (negated hits contribute zero) but expand cue coverage and scope logic in matcher so scorer receives cleaner `isNegated` flags.

### Grounding
- Files consulted: `src/signal/scorer/scorer.ts`, `src/constants/scoring.ts`, `src/types/scoring.ts`, `src/signal/matcher/negation.ts`, `docs/audtis/client/AUDIT_02_matching_scoring_technical.md`.
- Observed behavior: category contribution is max-per-category and phrase contribution is fixed per unique phrase.
- Observed behavior: `STRONG_THRESHOLD` is currently 6 and used downstream in aggregation.
- Observed behavior: scorer already returns structured `reasons`, so bucket-level reasons can be added without changing explainability model.

## 6) Matching V2 Improvements
Targeted matching changes (no ML, deterministic):

1. Extend negation cues and scope:
- Add Spanish finance negation cues (`ningun`, `ninguna`, `nunca`, `tampoco`, `ni`, `excepto`, `salvo`) and multi-token cues (`no requiere`, `sin necesidad de`, `no trabajamos con`).
- Add simple scope breakers (`pero`, `however`) to avoid over-negation in long sentences.

2. Add guarded company-name matching:
- Keep default behavior unchanged (`company` disabled by default).
- Add feature flag to allow company-name matching only for high-precision non-tech terms (for example `import export`, `logistica internacional`, `freight`), with low field multiplier (`0.35`) and stoplist filtering.

3. Add safe pattern detector layer:
- New module for explicit currency patterns: ISO codes list, currency pairs (`eur/usd`), symbol+amount patterns where safe.
- Pattern hits should be separate evidence objects and scored in direct_fx bucket.

4. URL false-positive mitigation:
- Remove URL/email substrings before tokenization in matcher input path.
- Keep raw text for audit logs; score on cleaned text only.

5. Keep exact token sequence as baseline:
- Existing exact-match logic remains, with pattern detector as additive signal source.

File-level impact for this section:
- `src/constants/negation.ts`, `src/signal/matcher/negation.ts`, `src/signal/matcher/matcher.ts`, `src/types/matching.ts`, and new `src/signal/matcher/patternDetectors.ts`.

### Grounding
- Files consulted: `src/signal/matcher/matcher.ts`, `src/signal/matcher/negation.ts`, `src/constants/negation.ts`, `src/utils/text/textNormalization.ts`, `src/constants/textNormalization.ts`, `tests/unit/negation.test.ts`.
- Observed behavior: negation is currently single-token cue lookup within fixed before/after windows.
- Observed behavior: matching runs only on title/description and does not have a pattern layer.
- Observed behavior: URL tokens can survive normalization and be matched as normal tokens.

## 7) Aggregation & Company-Level Metrics V2
Recommendation: keep existing metrics for continuity, add additive FX-specific metrics.

Keep unchanged:
- `max_score`, `offer_count`, `unique_offer_count`, `strong_offer_count`, `avg_strong_score`, `top_category_id`, `top_offer_id`, `category_max_scores`, `last_strong_at`.

Add new metrics:
- `fx_signal_offer_count`: canonical offers with `reasons.fxCore = true`.
- `fx_signal_max_score`: max FX-focused subtotal across canonical offers.
- `fx_signal_last_seen_at`: most recent timestamp among `fxCore` offers.
- `fx_signal_strong_offer_count` (optional): canonical offers where `fxCore=true` and `score >= 6`.

Recency weighting (optional, phase 4):
- `fx_recency_weighted_score = fx_signal_max_score * exp(-days_since_fx_last_seen / 180)`.
- Tradeoff: improves lead freshness ranking but introduces tunable temporal behavior; keep optional until tuned.

Export impact:
- Phase 1-2: keep A-J export unchanged.
- Phase 3 optional: expose new FX metrics in extra columns after J if operationally useful.

### Grounding
- Files consulted: `src/signal/aggregation/aggregateCompany.ts`, `src/signal/aggregation/mapCompanyOfferRows.ts`, `src/signal/aggregation/aggregateCompanyAndPersist.ts`, `src/db/repos/offersRepo.ts`, `src/types/db.ts`, `docs/audtis/client/AUDIT_03_company_aggregation.md`.
- Observed behavior: aggregation currently operates on canonical offers only and computes deterministic metrics.
- Observed behavior: strong status is currently `score >= STRONG_THRESHOLD` computed in `mapCompanyOfferRows()`.
- Observed behavior: aggregation only sees per-offer `score` and parsed `topCategoryId`, not full FX evidence.

## 8) Sheets Output Implications
Recommendation:
- Keep A-J stable for compatibility and existing client workflow.
- Add feedback columns beyond J for catalog tuning loop, and do not overwrite them.

Proposed additional columns (K-N, client-owned):
- `K model_verdict` (enum): `HIGH`, `MEDIUM`, `LOW`, `NONE` (optional, can be formula-driven).
- `L expected_interest` (enum): `HIGH_INTEREST`, `MEDIUM_INTEREST`, `LOW_INTEREST`, `NOT_A_TARGET`.
- `M score_feedback` (enum): `TOO_HIGH`, `ABOUT_RIGHT`, `TOO_LOW`.
- `N feedback_notes` (text, <= 500 chars).

System write rule:
- Keep exporter updates at D-J only (`buildMetricUpdateRange()` already does this).
- System can provision/validate headers and dropdowns for K-N but must never write row values in K-N.

Client workflow simplicity:
- Primary sorting remains on A-J metrics (`max_score`, `strong_offers`, `last_strong_at`).
- K-N is only analyst feedback for calibration, not required for daily lead triage.

Client Feedback Loop (False Positives / False Negatives):
- Feedback ingestion should extend the current resolution reader path to also parse K-N.
- Invalid K-N values should not block resolution processing; mark as `invalid_feedback_fields` and continue.
- Missing K-N values are valid and should be treated as nulls.

### Grounding
- Files consulted: `src/constants/sheets.ts`, `src/sheets/companyRowMapper.ts`, `src/sheets/updateCompanyMetrics.ts`, `src/utils/sheets/sheetsHelpers.ts`, `src/sheets/feedbackReader.ts`, `src/sheets/sheetReader.ts`, `docs/audtis/client/AUDIT_04_sheets_output_mapping.md`.
- Observed behavior: updater writes only metric slice D-J and preserves A-C and extra columns.
- Observed behavior: sheet read range is A:Z, so K-N can be parsed without changing read range.
- Observed behavior: current feedback reader parses only `company_id` and `resolution`.

## 9) File Impact Map (What to Modify)
| File | Why it needs changes | Planned high-level change | Complexity |
| --- | --- | --- | --- |
| `data/catalog.json` | Current taxonomy is proxy-tech heavy | Replace categories/keywords/phrases with FX-first taxonomy and negatives | M |
| `src/types/catalog.ts` | Current types do not model weights/buckets/negatives | Add optional V2 fields and runtime types for bucket/weight/negatives | M |
| `src/utils/catalogValidation.ts` | Validation only covers V1 shape | Validate V2 optional fields and references | M |
| `src/catalog/loader.ts` | Loader compiles only V1 keywords/phrases | Compile enabled flags, bucket, weights, negatives | M |
| `src/types/matching.ts` | No type for pattern hits / richer negation metadata | Add optional `patternHits` and source metadata | M |
| `src/constants/negation.ts` | Cue set too small for Spanish finance context | Expand cues and optional scope-break constants | S |
| `src/signal/matcher/negation.ts` | Windowed single-token cue check only | Support multi-token cues and scope breakers | M |
| `src/signal/matcher/matcher.ts` | No company-name guard, no URL filter, no pattern layer | Add URL pre-clean, guarded company matching, integrate pattern detector | L |
| `src/signal/matcher/patternDetectors.ts` (new) | Needed for safe currency detection | Implement deterministic currency/pair/symbol detectors | M |
| `src/constants/scoring.ts` | V1 constants not FX-dominant | Add bucket caps, phrase-tier weights, synergy constants | M |
| `src/types/scoring.ts` | Reasons do not expose bucket-level FX evidence | Add `bucketScores`, `fxCore`, `currencyCodeCount`, `negativePenalties` | M |
| `src/signal/scorer/scorer.ts` | V1 formula does not prioritize direct FX | Implement V2 bucketed formula and synergy/penalty logic | L |
| `src/ingestion/ingestOffers.ts` | Need side-by-side evaluation path | Add `SCORING_MODE` (`v1`,`dual`,`v2`) and write shadow score JSON to `matches.reasons` in dual mode | M |
| `src/db/repos/matchesRepo.ts` | `reasons` currently unused | Persist shadow payload and scorer metadata when provided | S |
| `src/db/repos/offersRepo.ts` | Aggregation only parses `topCategoryId` | Parse V2 reason fields needed for FX metrics | M |
| `src/types/db.ts` | Company/aggregation row types lack V2 FX fields | Add new company metric fields and row parse fields | M |
| `src/signal/aggregation/mapCompanyOfferRows.ts` | Current mapping cannot carry FX evidence | Map parsed FX evidence to aggregation input | M |
| `src/signal/aggregation/aggregateCompany.ts` | No FX-specific company metrics | Compute additive FX metrics | M |
| `src/signal/aggregation/aggregateCompanyAndPersist.ts` | Persists only V1 metric set | Persist new FX metrics (additive) | S |
| `src/db/repos/companiesRepo.ts` | Update method lacks new FX columns | Support updating/reading new FX metric columns | M |
| `migrations/0010_add_company_fx_metrics.sql` (new) | DB schema currently lacks FX company metrics | Add columns: `fx_signal_offer_count`, `fx_signal_max_score`, `fx_signal_last_seen_at`, optional `fx_signal_strong_offer_count` | M |
| `src/constants/sheets.ts` | Feedback columns K-N not modeled | Add optional feedback column constants and enum lists for validation | M |
| `src/types/sheets.ts` | Feedback DTOs only include resolution | Extend read result and change plan types to include K-N feedback fields | M |
| `src/sheets/feedbackReader.ts` | Reads only resolution feedback | Parse K-N fields with validation and row-level soft errors | M |
| `src/sheets/feedbackComparison.ts` | Diff logic uses only resolution | Include feedback payload in change/event plan | M |
| `src/sheets/feedbackPersistence.ts` | No feedback event storage | Persist lifecycle updates plus feedback events | M |
| `src/sheets/processSheetsFeedback.ts` | Orchestration does not expose extended feedback stats | Return extended counters for invalid feedback fields and event writes | S |
| `migrations/0011_add_company_feedback_events.sql` (new) | Need persistent feedback history | Create `company_feedback_events` table with indexes | M |
| `src/db/repos/companyFeedbackEventsRepo.ts` (new) | Needed to write/query feedback events | Insert/idempotency and analytics query helpers | M |
| `src/db/index.ts` | New repo export | Export feedback events repo | S |
| `src/ingestion/runOfferBatch.ts` | Need end-to-end feedback + analytics hooks | Call event persistence and optional periodic stats report | M |
| `scripts/report_feedback_catalog_tuning.ts` (new) | Need periodic FP/FN analytics | Emit top categories/phrases by feedback class and adjustment hints | M |
| `tests/unit/scorer.test.ts` | V1 expectations no longer valid for V2 mode | Add V2 coverage or split into `scorer.v1` and `scorer.v2` tests | M |
| `tests/unit/matcher.keywords.test.ts` | New company/pattern/url behavior | Add tests for guarded company matching and URL stripping | M |
| `tests/unit/matcher.phrases.test.ts` | Phrase-tier weighting and negation scope changes | Add V2 phrase and negation-scope tests | M |
| `tests/unit/negation.test.ts` | Cue/scope logic changes | Expand cue and scope-break test cases | M |
| `tests/unit/sheets/feedbackReaderGate.test.ts` | Extended feedback parsing | Add K-N parsing and invalid-field soft-failure tests | S |
| `tests/integration/db/m7_schema_smoke.test.ts` or new `tests/integration/db/m10_schema_smoke.test.ts` | Schema now includes new tables/columns | Assert migration applied for FX metrics and feedback events | S |

### Grounding
- Files consulted: `src/catalog/loader.ts`, `src/utils/catalogValidation.ts`, `src/signal/matcher/matcher.ts`, `src/signal/scorer/scorer.ts`, `src/signal/aggregation/aggregateCompany.ts`, `src/sheets/feedbackReader.ts`, `src/sheets/feedbackPersistence.ts`, `src/types/*.ts`, `migrations/*.sql`.
- Observed behavior: all required extension points already exist and are modular (loader, matcher, scorer, aggregation, sheets feedback pipeline).
- Observed behavior: `matches.reasons` is available and currently unused, enabling low-risk shadow scoring.
- Observed behavior: migration system is additive and ordered by filename.

## 10) Implementation Plan (Step-by-Step)
### Phase 1: catalog expansion + scoring tweak (fast wins)
1. Replace catalog taxonomy and terms in `data/catalog.json` with FX-first categories and downweighted tech proxy categories (still V1 schema-compatible if needed).
2. Implement phrase-tier-aware scoring in `src/signal/scorer/scorer.ts` and `src/constants/scoring.ts` (quick fix for current tier-ignore issue).
3. Expand negation cue list in `src/constants/negation.ts`.
4. Add URL pre-clean in matcher input path to reduce known `stripe.com` style false positives.
5. Run baseline fixture tests plus manual sanity set on existing fixture files in `tests/fixtures/infojobs/`.

### Phase 2: new schema weights + loader changes
1. Extend catalog schema/types/validation/loader for bucket, weights, enabled, negatives.
2. Implement pattern detector module for currency-specific patterns.
3. Implement V2 scorer with bucket caps and synergy while retaining V1 scorer path.
4. Add `SCORING_MODE=v1|dual|v2`:
- `v1`: current production behavior.
- `dual`: persist V1 in `matched_keywords_json`, V2 shadow in `matches.reasons`.
- `v2`: persist V2 in `matched_keywords_json`.
5. Add comparison utility/script to summarize V1 vs V2 deltas per offer/company from persisted shadow data.

### Phase 3: new metrics + Sheets columns
1. Add migration for company FX metrics and wire aggregation to compute/persist them.
2. Keep A-J export stable in first pass.
3. Add K-N feedback columns and validation rules in sheet provisioning (headers + dropdowns), while keeping row values client-owned.
4. Extend feedback reader/comparison/persistence to ingest K-N without breaking resolution lifecycle behavior.

### Phase 4: tuning + QA
1. Build calibration fixture packs:
- Strong FX positives (cross-border billing, suppliers abroad, AP/AR, multicurrency salary).
- Tech-only false positives (cloud/ads/payments stack with no FX).
- Hard negatives (domestic only, explicit no-international text).
2. Run dual mode for at least 2 full ingestion cycles and compute:
- Precision at top-N company rankings.
- False positive ratio among companies with `score >= 6`.
- Recall proxy on curated known-target set.
3. Tune bucket caps/weights/thresholds using deterministic config changes only.
4. Cutover to `SCORING_MODE=v2` after acceptance criteria are met.

### Testing strategy (fixtures-based)
1. Reuse existing fixtures in `tests/fixtures/infojobs/` and add new V2-focused fixtures:
- `fx06_import_export_treasury.json`
- `fx07_tourism_multicurrency.json`
- `fx08_tech_only_false_positive.json`
- `fx09_domestic_only_negative.json`
2. Add scorer golden tests that assert full reason payload (bucket scores, penalties, fxCore).
3. Add aggregation tests for new company FX metrics.
4. Add Sheets feedback parsing tests for K-N validation behavior.

### V1 vs V2 side-by-side validation approach
1. Run with `SCORING_MODE=dual`.
2. Keep downstream production ranking on V1 fields while collecting V2 shadow payload.
3. Generate periodic comparison report:
- Top companies promoted by V2.
- Top companies demoted by V2.
- Manual review sample for both lists.
4. Switch to `v2` only after manual sign-off.

### Client Feedback Loop (False Positives / False Negatives)
1. Sheets columns:
- Add K-N as described in section 8.
- Never overwrite K-N cell values during append/update cycles.
2. Feedback ingestion:
- Extend `readCompanyFeedbackFromSheet()` path to parse K-N along with resolution.
- Validation rules:
  - invalid enum in K/L/M -> record as invalid feedback field, continue resolution processing.
  - empty K/L/M/N -> valid null.
3. DB persistence:
- New table `company_feedback_events` with fields:
  - `id`, `company_id`, `model_verdict`, `expected_interest`, `score_feedback`, `feedback_notes`, `resolution_from`, `resolution_to`, `catalog_version`, `scoring_version`, `created_at`.
- Persist one event per processed row with dedupe hash for idempotent nightly runs.
4. Attribution analytics:
- Join feedback events with canonical offers and `matches.matched_keywords_json` reason payload.
- Compute top categories/phrases among:
  - False positives (high model verdict + low expected interest).
  - High-interest true positives.
- Emit markdown or console report with suggested catalog actions (demote, promote, add negatives).
5. Operational cadence:
- Weekly analytics run initially.
- Apply only small catalog deltas per iteration and re-evaluate in dual mode.

### Grounding
- Files consulted: `src/ingestion/ingestOffers.ts`, `src/db/repos/matchesRepo.ts`, `src/sheets/feedbackReader.ts`, `src/sheets/feedbackComparison.ts`, `src/sheets/feedbackPersistence.ts`, `src/ingestion/runOfferBatch.ts`, `tests/fixtures/infojobs/*.json`, `tests/e2e/sheets_feedback_offline.e2e.test.ts`.
- Observed behavior: feedback loop already has clear read/compare/validate/persist steps and can be extended without redesign.
- Observed behavior: existing fixtures and e2e tests provide a direct base for V1 vs V2 regression coverage.
- Observed behavior: `runOfferBatchIngestion()` already orchestrates sheet sync and feedback, so rollout hooks fit there.

## 11) Complexity / Effort / Risk Assessment
Effort estimate by phase:
- Phase 1: Small to Medium (1-3 engineering days).
- Phase 2: Medium to Large (4-7 engineering days).
- Phase 3: Medium (3-5 engineering days).
- Phase 4: Medium (3-4 engineering days, mostly calibration and QA).

Highest risk areas:
- Schema drift risk in catalog V2 fields if loader/validation defaults are incomplete.
- Precision regression if tech proxies remain too influential after tuning.
- Feedback consistency risk (analyst labeling quality and enum adherence).
- Aggregation/Sheets contract risk if optional new columns are made mandatory too early.

Performance considerations:
- Current matcher is token-position x alias loop; larger catalog can raise CPU.
- Mitigation: index aliases by first token and keep pattern detector narrow and deterministic.
- JSON parsing overhead in aggregation increases if more reason fields are read; keep parsed fields minimal and memoized per row.

Rollback strategy:
1. Keep `SCORING_MODE=v1` available at all times.
2. Use additive migrations only (no destructive column/table drops).
3. If V2 quality drops, revert to V1 mode and keep collecting feedback events for later tuning.
4. Keep A-J sheet behavior unchanged to avoid operational rollback on client workflow.

Client feedback loop specific risks:
- False negatives are under-observed because not all missed companies appear in sheet.
- Manual labels can be inconsistent across reviewers.
- Mitigation: enforce enums in sheet, track reviewer notes, and treat FN stats as directional.

### Grounding
- Files consulted: `src/signal/matcher/matcher.ts`, `src/catalog/loader.ts`, `src/sheets/updateCompanyMetrics.ts`, `src/sheets/feedbackReader.ts`, `src/db/migrate.ts`, `tests/helpers/testDb.ts`, `docs/RUNBOOK.md`.
- Observed behavior: migration runner is ordered and transactional, suitable for additive schema rollout.
- Observed behavior: sheet updater currently preserves non-metric columns, reducing rollback surface for client-facing workflows.
- Observed behavior: matcher currently does full alias scan per token, making catalog growth the main performance pressure.

## Definition of Done
- [x] Section `1) Executive Summary` exists.
- [x] Section `2) Gap Analysis vs V1 (Grounded in code + audits)` exists.
- [x] Section `3) V2 Signal Model (Features)` exists with A/B/C/D buckets and FP mitigations.
- [x] Section `4) Catalog V2 Design` exists with schema proposal and backward-compatibility plan.
- [x] Section `5) Scoring V2 Formula (Offer-Level)` exists with explicit formula and numeric examples.
- [x] Section `6) Matching V2 Improvements` exists with targeted upgrades and safe matching guidance.
- [x] Section `7) Aggregation & Company-Level Metrics V2` exists with continuity and new metric proposals.
- [x] Section `8) Sheets Output Implications` exists with A-J compatibility and beyond-J strategy.
- [x] Section `9) File Impact Map (What to Modify)` exists with file path, reason, change scope, complexity.
- [x] Section `10) Implementation Plan (Step-by-Step)` exists with four phases, testing strategy, and side-by-side validation approach.
- [x] Section `11) Complexity / Effort / Risk Assessment` exists with effort, risks, performance, and rollback.
- [x] Every section includes a `Grounding` subsection with consulted files and observed behavior bullets.
- [x] Client feedback loop add-on is included with: beyond-J columns, ingestion rules, DB persistence table, analytics output, and risks.
