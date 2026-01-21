## 1) [RESEARCH] Validate InfoJobs API auth and endpoints

**Objective:** Confirm exactly how we authenticate and which endpoints we need for MVP (search/list offers + offer detail).

**Key considerations:**

- Identify the official auth mechanism (how to obtain credentials/tokens, required headers).
- Confirm endpoints for:
  - listing/searching offers (with keyword + location filters)
  - fetching offer detail by offer ID
- Capture the _minimum fields_ we must rely on for the rest of the pipeline:
  - offer ID, title, company name/label, location, published date, link URL, description (snippet vs full)
- Note any constraints that affect implementation (required parameters, max results per page).

**Desired output:**

- A short “API notes” markdown (or notes section) including:
  - auth summary
  - endpoints + example request shapes
  - minimal required fields available
- 1–2 saved sample payloads (fixtures) from real API responses (sanitized if needed) to use during development/testing.
