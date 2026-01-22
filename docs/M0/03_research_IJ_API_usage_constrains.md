## 3) [RESEARCH] Review InfoJobs API usage constraints

**Objective:** Identify any usage/storage constraints that could affect how we persist and export data.

**Key considerations:**

- Any restrictions on storing offer content and for how long.
- Any restrictions on redistribution or downstream use (e.g., exporting to Sheets, internal use only).
- Any required attribution or compliance notes.
- Any “must-do” items (headers, user-agent, app identification) from the docs.

**Desired output:**

- A short summary of constraints relevant to the MVP with “do” / “don’t” statements we can follow during implementation.


## RESOLUTION

# InfoJobs API — Usage Constraints (Research Summary)

Based on the official InfoJobs API Terms of Use:

## What is explicitly stated
- Data obtained via the InfoJobs API **may be stored and used while the application remains active**.
- If the application **stops using the API** or **InfoJobs deactivates the app**, **all data obtained through the API must be deleted**.

## What is NOT explicitly restricted in the docs
- No documented time limit on how long data can be stored while the app is active.
- No explicit prohibition on exporting data to internal tools (e.g. Google Sheets).
- No explicit restriction on internal analytical or commercial use.
- No mandatory branding or attribution requirements documented.
- No specific User-Agent or header requirements documented.

## Practical interpretation for MVP
- OK to store job offer data locally and process it internally.
- OK to export derived/internal views (e.g. company signals to Sheets).
- Must be prepared to delete all stored data if API access is revoked or abandoned.
- Avoid public redistribution of raw offer data (not forbidden, but not covered).

This is sufficient to proceed safely with the MVP under current documentation.
