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

## RESOLUTION

# InfoJobs API — Research Notes (Auth + Offer Endpoints) — CLOSED v1 (scoped)

## 1) Authentication (public role, scope none, but developer credentials required)

### Required env vars (MVP)

- `IJ_CLIENT_ID`
- `IJ_CLIENT_SECRET`

### Auth mechanism

- Developer credentials are required (Client ID + Client Secret).
- Requests are authenticated via HTTP Basic using `clientId:clientSecret` in the `Authorization` header.

> Note: Both endpoints we use are documented as **User Role: public** and **Scope: none**, but still require developer credentials.

---

## 2) Endpoints we will use

### A) Search/List offers

- `GET https://api.infojobs.net/api/9/offer`
- Returns: paginated list of offers that comply with search criteria (+ optional facets).

### B) Offer detail

- `GET https://api.infojobs.net/api/7/offer/{offerId}`
- Returns: full detail of the offer with the given id.

---

## 3) GET /api/9/offer — Query parameters we will use (request)

We will search **Spain-wide** and optionally narrow by category/subcategory depending on the configured query.

### Geography (Spain-wide)

- `country` (optional): country filter. We will set this to `espana` for Spain-wide searches.

### Keyword search

- `q` (String, optional): keyword search.

### Optional query narrowing (MVP-supported)

- `category` (String, optional, repeatable): category filter (ignored if `subcategory` is present).
- `subcategory` (String, optional, repeatable): subcategory filter.

### Freshness / ordering / pagination

- `sinceDate` (String, optional; allowed: `_24_HOURS`, `_7_DAYS`, `_15_DAYS`, `ANY`)
- `order` (String, optional; default is `updated-desc`)
- `page` (Integer, optional)
- `maxResults` (Integer, optional; default 20; recommended <= 50)

### Optional (not needed for MVP)

- `facets` (Boolean, optional)

---

## 4) GET /api/9/offer — Response fields (response)

### Top-level result fields

We may store these for run/debug info (not essential for offer identity):

- `totalResults`, `currentResults`, `totalPages`, `currentPage`, `pageSize`, `sortBy`, `sinceDate`, `queryParameters`
- `offers` (list of Offer)

### Offer fields (per item in `offers[]`)

**We will keep (candidate MVP snapshot):**

- `id` (String) — offerId
- `link` (String) — offer URL
- `title` (String)
- `published` (Date, RFC3339)
- `updated` (Date, RFC3339)

**Company identity/display (minimal):**

- `author.id` (String)
- `author.name` (String)

**Extra fields we keep now (may help later; cheap to store):**

- `city` (String)
- `province` (PD: `{ id, value }`)
- `category` (PD)
- `subcategory` (PD)
- `contractType` (PD)
- `workDay` (PD)
- `experienceMin` (PD)
- `salaryMin` (PD)
- `salaryMax` (PD)
- `salaryPeriod` (PD)
- `salaryDescription` (String)
- `requirementMin` (String)

**Explicitly NOT keeping:**

- `teleworking` (PD)
- `author.uri`, `author.logoUrl`

---

## 5) GET /api/7/offer/{offerId} — Response fields we will keep (response)

**Offer identity + core matching evidence:**

- `id` (String)
- `link` (String)
- `title` (String)
- `description` (String)
- `minRequirements` (String)
- `desiredRequirements` (String)

**Offer timing + volume (cheap + useful):**

- `creationDate` (Date)
- `updateDate` (Date)
- `applications` (Long)

**Company identity/display (minimal):**

- `profile.id` (String)
- `profile.name` (String)
- `profile.hidden` (Boolean)

**Explicitly NOT keeping:**

- Full location fields (`zipCode`, `cityPD`, `country`, `latitude/longitude`, etc.)
- Extra company fields (`profile.web`, `profile.websiteUrl`, `profile.corporateWebsiteUrl`, `profile.clientId`, etc.)
