## 2) [RESEARCH] Assess InfoJobs API limits

**Objective:** Understand practical limits so the connector is built correctly from day one.

**Key considerations:**

- Pagination model: page/offset vs cursor, max page size, max reachable pages.
- Rate limits / throttling behavior (429 patterns, retry-after, etc.).
- Whether the API supports “delta” queries (since/updatedAfter) or if we must filter client-side.
- Any constraints that affect run cadence (daily vs twice daily) and per-query caps.

**Desired output:**

- A concise note listing:
  - pagination strategy we will implement
  - safe defaults for per-query caps and backoff
  - whether delta support exists and how we’ll use it (or fallback approach)
