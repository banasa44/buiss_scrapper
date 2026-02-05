### [DEFINE] Specify feedback semantics and lifecycle rules

**Objective**
Define, in a single source of truth, what each Sheets feedback value means and what the system must do when it changes.

**What this task should produce**

- A clear spec for the `resolution` field (allowed values + default).
- A state transition table:
  - `PENDING -> ...`
  - `ALREADY_REVOLUT | ACCEPTED | REJECTED -> ...`
  - What happens if the client flips a value back to `PENDING` (allowed or not?).
- Data retention rules per resolved company:
  - What gets deleted, what gets preserved (auditable minimal record), what is “frozen”.
- Ingestion behavior rules:
  - If a company is resolved, do we ignore new offers immediately?
  - Do we still keep a minimal company row? (recommended: yes, keep company + resolution + timestamps)
- Idempotency guarantees:
  - Re-processing the same sheet should not cause repeated destructive work.
- Logging + safety requirements:
  - No crashes on bad rows; log + skip
  - Destructive operations must be clearly logged + counted

**Deliverable**
A short spec doc under `docs/M6/` (or wherever M5 docs live), describing the semantics + lifecycle rules precisely.

---

### RESOLUTION

## Source of Truth

- **Google Sheets is the SSOT for client feedback.**
- The system:
  - **NEVER writes** to the feedback column.
  - **ONLY reads** the feedback column.
- Any decision made by the client in Sheets must be considered authoritative.

---

## Feedback Model (Single Column)

We will use a **single column named `resolution`** in the sheet.

Allowed values:

- `PENDING` (default)
- `IN_PROGRESS`
- `HIGH_INTEREST`
- `ALREADY_REVOLUT`
- `ACCEPTED`
- `REJECTED`

### Resolution Semantics

We define two categories:

**Resolved values**

- `ALREADY_REVOLUT`
- `ACCEPTED`
- `REJECTED`

**Not resolved (active) values**

- `PENDING`
- `IN_PROGRESS`
- `HIGH_INTEREST`

Only the first group triggers lifecycle actions.

---

## Lifecycle Effects of Resolutions

### When a company becomes RESOLVED

If the client changes a company to one of:

- `ALREADY_REVOLUT`
- `ACCEPTED`
- `REJECTED`

The system must:

1. **Immediately delete all offers for that company**
2. Stop ingesting any future offers for that company
3. Keep:
   - the company row
   - all aggregated metrics
4. Preserve the resolution value in the database exactly as in Sheets

### Rationale

- Aggregated metrics remain useful for analytics:
  - to learn which keywords/categories lead to ACCEPTED vs REJECTED outcomes
  - to improve scoring in the future
- Offers themselves are no longer operationally useful once resolved

---

## Data Ownership Rules

### What is kept

- Company entity remains in DB
- All aggregated metrics remain
- Resolution status is stored 1:1 from Sheets

### What is deleted

- All job offers belonging to resolved companies
- Any offer-level artifacts linked to those offers

### What is NOT affected

- Metrics of other companies
- Historical analytics data
- Any global keyword/category statistics

---

## Reading Strategy

### Columns to Read

The feedback processor will read:

- `company_id`
- `resolution`

No other columns are required.

- Any additional columns (e.g., notes) are purely for the client
- They are ignored by the system
- They are never written to the database

---

## Validation Rules

During feedback processing:

- Unknown `company_id` in sheet  
  → **ignore + warn**

- Duplicate `company_id` rows  
  → **ignore + warn**

- Invalid `resolution` value  
  → **ignore + warn**

- Malformed rows  
  → **ignore + warn**

Processing must be fully idempotent.

---

## Processing Order

The lifecycle will always be:

1. Ingest new offers
2. Update DB metrics
3. Update Google Sheets
4. **Read feedback from Sheets**
5. Apply lifecycle changes in DB

This ensures that even if a company is ingested shortly before being resolved, it will simply be cleaned immediately after.

---

## Safety Constraints

- The system must never modify the client’s resolution column.
- Feedback processing must be reversible and repeatable.
- Deletion of offers happens only after explicit client action.

---

## Out of Scope for M6

- Any automation based on “notes” or other client columns
- Per-resolution metrics tracking
- Real-time processing (scheduling strategy will be decided separately)

---

### Result of This DEFINE Task

After this task we will have:

- A fully specified feedback contract
- Clear lifecycle rules
- Deterministic behavior for all resolution values
- A concrete foundation for the BUILD implementation

Next step: **[DECISION] Choose feedback ingestion strategy**
