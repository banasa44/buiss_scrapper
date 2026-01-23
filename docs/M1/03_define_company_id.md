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
