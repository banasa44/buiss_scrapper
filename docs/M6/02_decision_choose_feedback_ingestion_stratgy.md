## M6 – DECISION: Feedback Ingestion Strategy

### Objective

Define **how and when** Google Sheets feedback is read and applied to the database, with minimal risk and minimal operational complexity.

This document captures the concrete decisions agreed for the feedback loop.

---

## Chosen Strategy

### Pull-on-Run + Nightly Window

We adopt a **hybrid approach**:

1. **Sheets export (DB → Sheets)**
   - Runs on every ingestion pipeline execution.
   - Happens immediately after company aggregation.

2. **Sheets feedback processing (Sheets → DB)**
   - Runs **only during a restricted time window: 03:00–06:00 (Spain time)**
   - Outside this window: feedback is NOT read.

### Why this strategy?

This approach provides:

- Protection against accidental misclicks
- Operational safety for destructive actions
- Simplicity (no extra services or schedulers)
- Low API usage
- Predictable behavior

---

## Execution Flow

Every normal pipeline run will be:

1. Ingest offers from providers
2. Update DB metrics
3. Export to Google Sheets
4. IF current time is within [03:00–06:00]:
   - Read feedback from Sheets
   - Apply lifecycle changes

Otherwise:

- Steps 1–3 run normally
- Step 4 is skipped

---

## Conflict Resolution Policy

### Source of Truth

- **Google Sheets always wins** for the `resolution` field.

Rules:

- If DB says `PENDING` and Sheets says `ACCEPTED` → ACCEPTED wins
- If DB says `ACCEPTED` and Sheets says `PENDING` → PENDING wins
- No internal DB logic can override client decisions

The system must treat the sheet column as authoritative.

---

## Change Detection Strategy

We choose a **simple full-scan approach**:

- On each feedback run:
  - Read all company_id + resolution rows
  - Compare with DB values
  - Apply changes as needed

### Rationale

- Number of companies is small
- No need for checksums or deltas
- Simplest and most robust approach
- Avoids complexity and state tracking

---

## Error Handling Rules

During feedback processing:

- Google Sheets API failure  
  → log warning + skip feedback step (non-fatal)

- Invalid row data  
  → ignore row + warn

- Unknown company_id  
  → ignore + warn

- Duplicate company_id rows  
  → ignore duplicates + warn

**No feedback error should ever break ingestion.**

---

## Destructive Actions Policy

When a company becomes resolved:

- Offer deletion happens **immediately**
- No soft-delete phase
- No dry-run mode required
- The user will be clearly warned about the risk

Rationale:

- The lifecycle is simple and deterministic
- The client is explicitly responsible for the column
- Immediate cleanup keeps the system tidy

---

## Data Scope

### What we read from Sheets

Only:

- `company_id`
- `resolution`

All other columns are ignored.

### What we never read

- Metrics columns
- Names
- Notes
- Any client-created fields

The system only needs the feedback decision.

---

## Performance & Quota Considerations

- Feedback processing runs at most once per day
- Very low API usage
- No risk of hitting rate limits
- No need for advanced batching strategies

---

## Edge Case Handling

### New company ingested just before resolution

Possible sequence:

1. A new company is ingested
2. Metrics updated
3. Exported to Sheets
4. Immediately marked as ACCEPTED by client
5. Next nightly run deletes its offers

This is acceptable and expected.

There is no harmful race condition in this model.

---

## Summary of Decisions

| Topic                    | Decision                        |
| ------------------------ | ------------------------------- |
| When to export to Sheets | Every pipeline run              |
| When to read feedback    | Only 03:00–06:00                |
| SSOT for resolution      | Google Sheets                   |
| Change detection         | Full scan, no deltas            |
| Error policy             | Best-effort, non-fatal          |
| Destructive action       | Immediate delete                |
| Columns read             | Only company_id + resolution    |
| Scheduling               | Integrated in existing pipeline |

---

### Result of This DECISION Task

We now have:

- A clear and safe ingestion strategy
- Predictable timing
- Minimal operational risk
- No need for extra infrastructure

Ready to proceed with:

**M6 – BUILD: Implement Sheets feedback processor**
