# Phase 4 Audit — External Integrations (InfoJobs + Sheets)

**Correctness risks**
- HTTP JSON parse failures are treated as success with `undefined` payloads, which can propagate into mapping logic and lead to runtime errors or ambiguous failures. (`src/clients/http/httpClient.ts:performRequest`, `src/clients/infojobs/infojobsClient.ts:searchOffers`, `src/clients/infojobs/infojobsClient.ts:getOfferById`)
- InfoJobs `updatedSince` mapping treats future dates as "_24_HOURS" due to negative `diffDays`, which can silently widen query scope. (`src/clients/infojobs/infojobsClient.ts:mapUpdatedSinceToSinceDate`, `src/constants/clients/infojobs.ts:INFOJOBS_MS_PER_DAY`)
- Google Sheets token fetch has no explicit timeout or retry; a hung token request can block sheets operations even when `apiRequest` has timeouts. (`src/clients/googleSheets/googleSheetsClient.ts:getAccessToken`, `src/clients/googleSheets/googleSheetsClient.ts:apiRequest`)

**Maintainability improvements**
- InfoJobs hard-coded bucket strings (`"_24_HOURS"`, `"_7_DAYS"`, `"_15_DAYS"`, `"ANY"`) and order strings (`"updated-desc"`) are embedded in client logic rather than constants, which makes policy tweaks harder to find. (`src/clients/infojobs/infojobsClient.ts:mapUpdatedSinceToSinceDate`, `src/clients/infojobs/infojobsClient.ts:mapSortToOrder`, `src/constants/clients/infojobs.ts`)
- Sheets update flow mixes pure mapping with IO (row selection + mapping + update calls); similar to `exportPlanner`, a pure "plan builder" for updates would isolate mapping logic and simplify testing. (`src/sheets/updateCompanyMetrics.ts:updateCompanyMetricsInSheet`, `src/sheets/exportPlanner.ts:buildExportPlan`, `src/sheets/companyRowMapper.ts:mapCompanyToSheetRow`)

**HTTP client (error taxonomy, retries, timeouts)**
- Error taxonomy: non-2xx responses throw `HttpError` with status, URL, headers, and optional body snippet. (`src/clients/http/httpError.ts:HttpError`, `src/clients/http/httpClient.ts:performRequest`)
- Retry policy: retries only for idempotent methods (`GET`, `HEAD`) and for network/timeout errors or retryable status codes (408, 429, 5xx). (`src/constants/clients/http.ts:RETRYABLE_HTTP_METHODS`, `src/constants/clients/http.ts:RETRYABLE_STATUS_CODES`, `src/clients/http/httpClient.ts:isErrorRetryable`, `src/clients/http/httpClient.ts:httpRequest`)
- Backoff: exponential with jitter, clamped to `DEFAULT_MAX_DELAY_MS`, and respects `Retry-After` with its own clamp. (`src/clients/http/httpClient.ts:computeBackoffDelay`, `src/clients/http/httpClient.ts:computeRetryDelay`, `src/constants/clients/http.ts:DEFAULT_MAX_DELAY_MS`, `src/constants/clients/http.ts:DEFAULT_MAX_RETRY_AFTER_MS`)
- Timeouts: per-request timeout implemented via `AbortController` in `performRequest`. (`src/clients/http/httpClient.ts:performRequest`, `src/constants/clients/http.ts:DEFAULT_HTTP_TIMEOUT_MS`)
- Missing safety note: non-JSON responses are returned as text without error; JSON parse failures return `undefined`, so callers must handle this explicitly. (`src/clients/http/httpClient.ts:performRequest`)

**InfoJobs client (pagination, mapping, nullability)**
- Pagination and caps: `maxPages`, `maxOffers`, and `pageSize` are enforced with clamping, and pagination stops on empty pages or known `totalPages`. (`src/clients/infojobs/infojobsClient.ts:searchOffers`, `src/clients/infojobs/infojobsClient.ts:clampPageSize`, `src/constants/clients/infojobs.ts:INFOJOBS_DEFAULT_MAX_PAGES`, `src/constants/clients/infojobs.ts:INFOJOBS_DEFAULT_MAX_OFFERS`, `src/constants/clients/infojobs.ts:INFOJOBS_DEFAULT_PAGE_SIZE`)
- Error handling: 401/403 fail fast with explicit auth error; other errors stop pagination and set `truncatedBy="error"`. (`src/clients/infojobs/infojobsClient.ts:searchOffers`)
- Mapping completeness: list items map author/company name, location, metadata, and requirement snippet; detail mapping adds description, requirements, salary, and website identity fields with domain filtering. (`src/clients/infojobs/mappers.ts:mapInfoJobsOfferListItemToSummary`, `src/clients/infojobs/mappers.ts:mapInfoJobsOfferDetailToDetail`)
- Nullability handling: missing `raw.id` returns `null` (offer skipped), titles default to empty string, and missing metadata collapses to `undefined`. (`src/clients/infojobs/mappers.ts:mapInfoJobsOfferListItemToSummary`, `src/clients/infojobs/mappers.ts:mapInfoJobsOfferDetailToDetail`)
- Magic numbers and default knobs live in constants (`INFOJOBS_DEFAULT_MAX_PAGES`, `INFOJOBS_DEFAULT_MAX_OFFERS`, `INFOJOBS_DEFAULT_PAGE_SIZE`, `INFOJOBS_MAX_PAGE_SIZE`), while the `updatedSince` buckets and order strings are inline. (`src/constants/clients/infojobs.ts`, `src/clients/infojobs/infojobsClient.ts:mapUpdatedSinceToSinceDate`, `src/clients/infojobs/infojobsClient.ts:mapSortToOrder`)

**Google Sheets (batching, retries, auth, partial failure)**
- Auth: service account JWT is generated locally; access token cached until near expiry, then refreshed. (`src/clients/googleSheets/googleSheetsClient.ts:createJWT`, `src/clients/googleSheets/googleSheetsClient.ts:getAccessToken`, `src/constants/clients/googleSheets.ts:GOOGLE_SHEETS_TOKEN_EXPIRY_BUFFER_SECONDS`)
- Retry logic: `apiRequest` retries 5xx, 429, 408 with exponential backoff and caps; no jitter and no `Retry-After` handling. (`src/clients/googleSheets/googleSheetsClient.ts:apiRequest`, `src/constants/clients/googleSheets.ts:GOOGLE_SHEETS_DEFAULT_MAX_ATTEMPTS`, `src/constants/clients/googleSheets.ts:GOOGLE_SHEETS_DEFAULT_MAX_DELAY_MS`)
- Timeouts: API requests use `AbortSignal.timeout` with a fixed default. (`src/clients/googleSheets/googleSheetsClient.ts:apiRequest`, `src/constants/clients/googleSheets.ts:GOOGLE_SHEETS_DEFAULT_TIMEOUT_MS`)
- Partial failure behavior: read/update/append return `SheetOperationResult` and callers log/return errors without throwing; `syncCompaniesToSheet` aggregates append+update results and reports combined status. (`src/clients/googleSheets/googleSheetsClient.ts:readRange`, `src/clients/googleSheets/googleSheetsClient.ts:batchUpdate`, `src/clients/googleSheets/googleSheetsClient.ts:appendRows`, `src/sheets/syncCompaniesToSheet.ts:syncCompaniesToSheet`)
- Batching knobs live in `src/constants/sheets.ts` (`SHEETS_APPEND_BATCH_SIZE`, `SHEETS_UPDATE_BATCH_SIZE`); updates are performed row-by-row within each batch. (`src/sheets/appendNewCompanies.ts:appendNewCompaniesToSheet`, `src/sheets/updateCompanyMetrics.ts:updateCompanyMetricsInSheet`, `src/constants/sheets.ts`)

**Contract clarity (types vs usage)**
- HTTP types (`HttpRequest`, `HttpRetryConfig`, `HttpErrorDetails`) match the wrapper usage and are re-exported in `src/clients/http/index.ts`. (`src/types/clients/http.ts`, `src/clients/http/httpClient.ts`, `src/clients/http/index.ts`)
- InfoJobs raw types match mapper usage (list and detail shapes are minimal and map only used fields). (`src/types/clients/infojobs.ts`, `src/clients/infojobs/mappers.ts`)
- Google Sheets client types match usage in the client and `src/sheets/*` call sites. (`src/types/clients/googleSheets.ts`, `src/clients/googleSheets/googleSheetsClient.ts`, `src/sheets/sheetReader.ts`)

**Test alignment (fixtures, coverage)**
- InfoJobs client mapping is exercised in `tests/e2e/infojobs_offline.test.ts` using `sample_search_response.json` and a minimal detail payload; this covers basic mapping and error on unmocked HTTP. (`tests/e2e/infojobs_offline.test.ts`, `tests/fixtures/infojobs/sample_search_response.json`)
- End-to-end ingestion path with mock HTTP + real DB is covered in `tests/e2e/infojobs_pipeline_offline_db.test.ts`. (`tests/e2e/infojobs_pipeline_offline_db.test.ts`)
- Fixtures used for signal/ingestion E2E tests are synthetic and do not mirror full InfoJobs API shapes; they are suitable for signal logic but not for validating InfoJobs mapping coverage. (`tests/fixtures/infojobs/fx01_strong_usd_signal.json`, `tests/fixtures/infojobs/fx05_phrase_boost_fx.json`, `tests/e2e/ingestion_to_aggregation.e2e.test.ts`)
- No E2E coverage exists for Google Sheets read/append/update flows or for HTTP retry/timeout behavior in `src/clients/http`. (`src/clients/googleSheets/googleSheetsClient.ts`, `src/sheets/*`, `src/clients/http/httpClient.ts`, `tests/e2e/*`)
- No E2E coverage exists for InfoJobs pagination truncation (maxPages/maxOffers), invalid offers arrays, or auth error paths (401/403). (`src/clients/infojobs/infojobsClient.ts:searchOffers`, `tests/e2e/*`)
