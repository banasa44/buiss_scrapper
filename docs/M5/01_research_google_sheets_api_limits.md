### [RESEARCH] Validate Google Sheets API limits

**Task goal**

Before designing any real exporter, we must clearly understand the operational limits of Google Sheets and its API to avoid choosing an implementation that will not scale or will be unreliable.

This task is purely about research and documentation, not about coding.

**Key questions to answer**

- What are the actual Google Sheets API limits?
  - requests per minute / per user / per project
  - maximum spreadsheet size (rows, columns, cells)
  - relevant quotas or costs
- What practical throughput can we expect for:
  - appending rows
  - updating existing rows
  - batch updates
- What write strategies does Google recommend?
  - append-only
  - batchUpdate
  - full sheet replacement
- How are common failure scenarios handled?
  - rate limiting
  - retries
  - partial failures
  - timeouts

**Expected outcome**

A concise technical document (for example `docs/sheets_limits.md`) containing:

- a clear summary of discovered limits
- concrete recommendations for our specific use case
- identified risks and constraints
- practical conclusions that will drive the next decision task

This research will be the foundation for deciding **how** the export to Sheets should be implemented.

## Findings & Conclusions (Focused on Our Use Case)

### Relevant API Limits

- Google Sheets API uses **per-minute rate limits**:
  - ~300 requests/min per project
  - ~60 requests/min per user
- Limits apply to both reads and writes.
- Exceeding limits returns **HTTP 429**, requiring retry with backoff.

### Practical Implications

- Row-by-row API operations are not viable.
- Any design must rely on:
  - **batched reads**
  - **batched writes**
  - low-frequency synchronization

### Read Strategy Conclusions

- The `is_interested` column can be fetched efficiently in **one request** using an A1 range (e.g., `Sheet1!C:C`).
- Google Sheets API provides **no server-side filtering**:
  - all filtering must be done client-side after reading.
- Continuous polling is discouraged; results should be cached locally.

### Write Strategy Conclusions

- The only scalable patterns are:
  - **append-only writes**, or
  - **periodic batched updates**
- Per-row updates would quickly exceed quotas.
- Export operations must group multiple companies into single API calls.

### Expected Throughput

- Safe operational model:
  - tens of operations per minute without special handling
  - hundreds only when heavily batched
- This is more than enough for exporting a few hundred or thousand companies.

### Constraints for Our System

- Google Sheets can be used as:
  - a reporting/output layer
  - a lightweight feedback channel (`is_interested`)
- It must **not** be treated as a real-time transactional database.

### Final Conclusion

For this project, Google Sheets is perfectly suitable **if** we design around:

- low-frequency exports
- append-oriented workflows
- batched operations
- minimal polling of user-modified columns

The exporter must therefore be built with:

- batch writes as the default
- occasional full refreshes if needed
- local caching to avoid frequent API calls
