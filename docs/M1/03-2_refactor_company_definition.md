# [DEFINE] 03_2 — Refactor company definition (identity evidence + schema)

## Objective

Plan the concrete refactor needed to support the agreed company identity resolution:
**website/domain → normalized_name → (derived from raw name)**, and **skip offers** when company cannot be identified deterministically.

This task is a short implementation route for the next BUILD step.

---

## Inputs to inspect (must-read)

- `docs/M1/03_define_company_identity_rules.md` (RESOLUTION + TODO)
- InfoJobs raw types + mappers:
  - `src/types/clients/infojobs.ts`
  - `src/clients/infojobs/mappers.ts`
- Normalized job offer types:
  - `src/types/clients/job_offers.ts`
- Current DB schema + repos:
  - `docs/M1/01_define_db_schema.md`
  - `migrations/0001_init.sql`
  - `src/db/repos/companiesRepo.ts`
  - `src/db/repos/offersRepo.ts`

---

## Deliverables (this task produces a plan, not code)

1. A short checklist of the exact fields we will support for **company identity evidence**.
2. A mapping decision: which provider fields populate which generic company fields.
3. A DB delta (new columns + constraints/indexes) needed to enforce deterministic dedupe.
4. A clear “skip rules” section for ingestion (what gets dropped and how we log/counter it).

---

## Step A — Inspect provider fields (InfoJobs first)

### Goal

Confirm whether InfoJobs provides any website-like field at all, and what its shape is (URL, domain, array, etc.).

### Actions

- Review the InfoJobs raw response types and/or fixtures referenced in M0 docs.
- In `mappers.ts`, identify the exact raw paths we already touch under `company/profile`.

### Output

Write down:

- `hasCompanyWebsiteField: yes/no`
- If yes: list candidate raw fields (exact names/paths).
- If no: explicitly state “InfoJobs does not provide website in our observed payloads”.

---

## Step B — Update provider-agnostic types (generic, not InfoJobs-specific)

### Goal

Extend our normalized types so future providers can supply stronger identity evidence without schema churn.

### Changes (planned)

In `src/types/clients/job_offers.ts`:

- Extend `JobOfferCompany` with optional fields:
  - `nameRaw?: string` (or reuse `name` as raw, but be explicit)
  - `normalizedName?: string`
  - `websiteUrl?: string`
  - `websiteDomain?: string` (derived from websiteUrl; store only if derivable)
- Keep existing fields (`id`, `name`, `hidden`) intact.

### Notes

- No provider-specific enums or shapes in normalized types.
- If we derive `websiteDomain`, define normalization rules (lowercase, strip `www.`, strip trailing slash, etc.) in a shared utility later (BUILD task).

---

## Step C — Update InfoJobs mapping (raw → normalized)

### Goal

Populate the new generic company fields when evidence exists.

### Actions (planned)

- In `src/clients/infojobs/mappers.ts`:
  - Ensure we always set:
    - `company.name` (display)
    - `company.nameRaw` (if different; otherwise same as name)
    - `company.normalizedName` (computed deterministically)
  - If a website-like raw field exists:
    - map to `company.websiteUrl`
    - derive `company.websiteDomain` if possible
- Ensure mapper never throws due to bad/missing fields: log + leave undefined.

---

## Step D — DB schema changes (companies table)

### Goal

Persist identity evidence and enforce deterministic dedupe.

### Changes (planned)

In companies table (and migration `0002_...sql`):

- Add columns:
  - `name_raw TEXT`
  - `normalized_name TEXT`
  - `website_url TEXT`
  - `website_domain TEXT`
- Constraints/indexes:
  - UNIQUE on `website_domain` when not null (SQLite unique allows multiple NULLs)
  - UNIQUE on `normalized_name` when website_domain is null (enforced in ingestion logic; DB uniqueness can still be global on normalized_name if we accept collisions)
  - Add index(es) used by lookup:
    - `idx_companies_domain` on `website_domain`
    - `idx_companies_normalized_name` on `normalized_name`

> Decide explicitly (and document):
>
> - Do we want UNIQUE(normalized_name) globally?
>   - If yes: simplest, but may wrongly merge two different companies with same name.
>   - If no: keep it indexed only and let ingestion decide (still deterministic, but requires careful lookup rules).

---

## Step E — Repo contract changes (CompaniesRepo)

### Goal

Support deterministic attach/create logic based on evidence order.

### Planned API changes

- `upsertCompanyByDomain(domain, fields...) -> companyId`
- `upsertCompanyByNormalizedName(normalizedName, fields...) -> companyId`
- Internally: always prefer domain path if present.

---

## Step F — Ingestion skip rules (must be implemented later, but defined here)

### Rules

- If `websiteDomain` is missing AND `normalizedName` is missing:
  - **Skip offer**
  - Log `warn` with provider + offer id
  - Increment a counter (exact naming decided in BUILD ingestion task)

---

## Acceptance criteria (for this DEFINE task)

- The plan is precise enough that the next BUILD prompt can be executed without guessing.
- Generic types remain provider-agnostic.
- DB changes are minimal and directly support the resolution order.
