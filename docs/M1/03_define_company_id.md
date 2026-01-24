# [DEFINE] Specify company identity rules

## Objective

Define deterministic rules for identifying “the same company” across runs and offers.

## Must-use inputs

- Review what InfoJobs provides for company fields in raw types and mappers.

## What to decide

1. Provider-scoped identity:
   - Prefer stable provider company id when present.
2. Fallback identity when company id is missing/hidden:
   - How to normalize company name (casefold, trim, collapse whitespace, remove punctuation?)
   - Whether to include location hints (careful: can over-split)
3. When to create a new company vs attach to existing:
   - Exact matching only vs fuzzy (start with exact only)

## Rules (recommended starting point)

- Primary key for dedupe:
  - If `company.id` exists => identity = `{provider}:{companyId}`
  - Else if `company.name` exists => identity = `{provider}:name:{normalizedName}`
  - Else => company is “unknown” (single shared placeholder per provider OR store null and allow offers without company FK)

## Output of this task

- A written spec of the identity algorithm (inputs → identity key).
- Edge cases (hidden company, missing name, weird casing) and how we handle them.
- DB implication: which columns/indexes must support these rules.

## Acceptance criteria

- Rules are implementable deterministically.
- No fuzzy matching in MVP (unless explicitly chosen).

## RESOLUTION

We will use a **deterministic, evidence-ordered identity strategy** for companies.

### Identity evidence order (strong → weak)

1. **Website / domain (when available)**
   - If we have a usable `website_url`, derive `website_domain` (normalized).
   - **Identity key = `domain:<website_domain>`**.
   - This is the strongest cross-run / cross-source signal and avoids name-variant duplicates.

2. **Normalized company name (when website/domain is missing)**
   - Compute `normalized_name` from the best available company name string.
   - **Identity key = `name:<normalized_name>`**.
   - Exact match only (no fuzzy).

3. **Raw company name (last resort input for normalization)**
   - If only raw `name` is available, we still compute `normalized_name` from it.
   - If we cannot obtain any name-like string at all → **skip offer** (log + counter). We do not create “unknown company” rows.

### Normalization rules (initial)

- trim
- lowercase
- collapse repeated whitespace to single spaces
- (optional but recommended) strip accents/diacritics for stability
- remove trailing legal suffix noise when clearly present (e.g., `sl`, `s.l.`, `slu`, `sa`, `s.a.`) — keep this conservative and documented
- no fuzzy matching, no location hints

### DB implications (high-level)

- Companies table must support:
  - `website_url` (nullable)
  - `website_domain` (nullable) + UNIQUE index when not null
  - `name_raw` (nullable)
  - `normalized_name` (nullable) + UNIQUE index (or at least indexed) for deterministic attach

---

## TODO (Refactor tasks required)

1. **Inspect provider APIs (starting with InfoJobs)**
   - Confirm which company fields exist (especially website-related fields).
   - Record findings in the relevant M0 research doc updates if needed.

2. **Update our provider-agnostic types + mappers**
   - Add optional company fields needed for identity evidence (at minimum `website_url` / `website_domain` and `name_raw` / `normalized_name`).
   - Keep these fields **generic** (not InfoJobs-specific): the provider API is only inspiration; our types must work for other sources too.

3. **Update DB schema**
   - Add/adjust `companies` columns required by the identity rules:
     - `website_url`, `website_domain`, `name_raw`, `normalized_name`
   - Add the minimal indexes/constraints that enforce deterministic dedupe (e.g., unique domain when present, unique normalized_name otherwise).
