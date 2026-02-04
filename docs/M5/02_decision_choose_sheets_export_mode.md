# Sheets Export Strategy (M5)

## Objective

Define a robust, low-risk strategy to export ranked **companies (aggregated)** from the DB to a shared Google Sheet, while preserving client edits and enabling a simple feedback signal to be read back later.

---

## Core Requirements (from product workflow)

- Export **aggregated companies only** (not individual offers).
- Include a broad set of company metrics (target ~7–10 columns).
- Client can freely sort/filter and add their own columns.
- Export must **preserve client-edited columns**, especially the feedback column.
- Use a stable identifier to reconcile rows: **`company_id`**.
- Execution model: run **after each ingestion run** (cron / pipeline step).
- If a company’s metrics change (up/down), update them in the sheet.
- If the client deletes a row, it should be recreated on the next export if the company still exists in DB.
- One shared spreadsheet.

---

## Chosen Export Mode: Incremental Upsert by `company_id`

### Summary

Use `company_id` as the primary key to synchronize rows:

- **Update** existing rows when metrics change (batched writes)
- **Append** new companies when they appear
- Preserve any client-managed data

This approach remains correct even if the client reorders rows or applies filters.

### Why this mode

- Avoids full rewrites that may disrupt client workflow and increase quota usage.
- Minimizes request count (batch updates + append).
- Keeps a stable sheet where client can work naturally.
- Provides a clean foundation for the future feedback loop.

---

## Sheet Contract

### Mandatory key column

- `company_id` (stable DB identifier)
- This column is authoritative for row matching.

### Exported metric columns

- Export ~7–10 columns from the aggregated company metrics.
- Exact columns will be decided by inspecting DB schema and kept stable via constants.

### Client freedom & preservation rules

- Client may add extra columns.
- Exporter must never delete or overwrite unknown columns.
- Exporter must not change row ordering or formatting.

---

## Feedback Column (prepared in M5, applied in M6)

### Single editable column

A client-editable column is included:

**`resolution`**

Allowed values (enum):

- `PENDING` (default)
- `ALREADY_REVOLUT`
- `ACCEPTED`
- `REJECTED`

Notes:

- The client only edits **one column**, reducing mistakes.
- `PENDING` means “not resolved”.
- Any other value implies “resolved” with a reason.

### Exporter rules regarding feedback

- Exporter **must not overwrite** `resolution`.
- Exporter may read `resolution` (for later phases), but applying it to DB is out of scope for M5.

---

## Operational Flow (per run)

Triggered after each ingestion run (cron/pipeline step):

1. **Read phase**
   - Read the sheet range containing:
     - `company_id`
     - `resolution`
   - Build mapping: `company_id -> rowIndex`
   - (Optional for M5) validate read succeeds; do not mutate DB.

2. **Write phase**
   - For each company selected for export:
     - If `company_id` exists in sheet:
       - update metric columns for that row (batch update)
     - else:
       - append a new row (append)
   - Ensure `resolution` is left untouched.

3. **Preservation**
   - Never touch client-added columns.
   - Never re-sort or reformat the sheet.

---

## Execution Model

- Export runs automatically after each DB update run.
- Single shared spreadsheet.

---

## Reliability Requirements

- Use batched operations by default.
- Implement retries with exponential backoff for 429 / transient errors.
- Export should be idempotent and safe to rerun.
- A failed export must not impact DB correctness.

---

## Special Cases

- **Metric decreases**: still updated in place (no special handling).
- **Deleted row by client**: recreated next run if company still exists in DB.
- **New companies**: appended.

---

## Out of Scope for M5 (belongs to M6)

- Apply `resolution` to DB (mark resolved / ignore / cleanup).
- Ensure resolved companies are excluded from future ingestion/aggregation.
- Data deletion / tombstoning policy and audit trail.

---

## Final Decision

Implement an incremental, idempotent Google Sheets exporter:

- primary key: `company_id`
- write strategy: batch update existing rows + append new rows
- preserve client data and formatting
- include a single feedback column `resolution` with enum values:
  `PENDING | ALREADY_REVOLUT | ACCEPTED | REJECTED`

This provides a stable reporting surface for the client and a clean base for the M6 feedback loop.
