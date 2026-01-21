## 4) [BUILD] Implement InfoJobs connector

**Objective:** Build a working, testable connector that can fetch offers for a query and (if needed) fetch offer details.

**Key considerations:**

- Clear interface:
  - `searchOffers(queryParams) -> OfferSummary[]`
  - `getOfferDetail(offerId) -> OfferDetail`
- Handle pagination according to the research (stop conditions, caps).
- Basic resilience:
  - timeouts, retries with backoff for transient errors
  - clear errors for auth failures
- Minimal normalization at the connector boundary:
  - map API payloads into internal `JobPosting` shape (even if partial)
- Logging:
  - per-query counts (fetched pages, offers returned)
  - error summaries without being noisy

**Desired output:**

- A connector module callable from a simple script/runner that can:
  - run 1 query and fetch a small batch successfully
  - print/log a small sample of normalized records (id, title, company label, link, published date)
- A minimal configuration stub for credentials and a sample query (kept out of git via env/config patterns).
