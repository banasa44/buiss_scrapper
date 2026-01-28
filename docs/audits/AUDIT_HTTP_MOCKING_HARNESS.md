# HTTP Mocking Harness - Implementation Audit

**Date:** 2024-01-27  
**Status:** ✅ Complete  
**Test Results:** All 85 tests passing (3 new E2E tests added)

## Overview

Implemented HTTP mocking infrastructure to enable E2E testing of InfoJobsClient without network calls. This allows complete offline testing of the full ingestion pipeline with mocked HTTP responses.

## Implementation Details

### 1. Mock HTTP Helper (`tests/helpers/mockHttp.ts`)

**Purpose:** Route-based HTTP request mocking for test isolation

**Features:**

- Route registration by method + URL
- Fixture JSON responses
- Throws loudly on unmocked requests (prevents accidental network calls)
- Request recording for debugging
- Query parameter stripping for flexible matching

**API:**

```typescript
const mock = createMockHttp();
mock.on("GET", "https://api.example.com/resource", fixtureData);
const client = new InfoJobsClient({ httpRequest: mock.request });
```

**Design Decision:** Simple route matching (method + base URL, ignoring query params) sufficient for current needs. Can be extended for query param matching if needed.

### 2. InfoJobsClient Refactor

**Changed:** Constructor signature from `(httpRequest?: HttpRequestFn)` to `(config?: InfoJobsClientConfig)`

**Config Interface:**

```typescript
interface InfoJobsClientConfig {
  httpRequest?: HttpRequestFn; // For HTTP mocking
  credentials?: {
    // For test credentials
    clientId: string;
    clientSecret: string;
  };
}
```

**Rationale:**

- Clean dependency injection seam for HTTP layer
- No globals, test-only hooks, or environment pollution
- Supports mocking credentials (no need for env vars in tests)
- Backwards compatible (empty constructor still uses env vars + default httpRequest)

**Implementation Changes:**

1. Added optional `config` parameter to constructor
2. Changed all internal `httpRequest` calls to `this.httpRequest`
3. Use injected `config?.httpRequest` or fall back to default `defaultHttpRequest`
4. Use injected `config?.credentials` or fall back to env vars

### 3. E2E Test Suite (`tests/e2e/infojobs_offline.test.ts`)

**Coverage:** 3 tests proving offline E2E capability

| Test                                        | Validates                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `should search offers using mocked HTTP`    | Full search flow with fixture → canonical mapping → result shape                         |
| `should throw on unmocked requests`         | Mock throws → client handles gracefully (returns `{ offers: [], truncatedBy: "error" }`) |
| `should get offer detail using mocked HTTP` | Detail fetch → mapping → canonical output                                                |

**Key Assertions:**

- ✅ Canonical shapes (`ref.provider`, `ref.id`, `company.normalizedName`)
- ✅ Field normalization (company name, salary, skills)
- ✅ Pagination control (`maxPages: 1`)
- ✅ Error handling (unmocked requests trigger graceful degradation)

**Fixture Strategy:**

- Search: Reuses existing `tests/fixtures/infojobs/sample_search_response.json`
- Detail: Inline minimal fixture (easier to maintain per-test variations)

## Test Results

```
Test Files  5 passed (5)
     Tests  85 passed (85)
```

**Breakdown:**

- Unit (companyIdentity): 45 tests
- Unit (infojobs.mappers): 29 tests
- Integration (DB harness): 3 tests
- Integration (DB offer ingestion): 5 tests
- **E2E (InfoJobs offline): 3 tests** ← NEW

**TypeScript:** ✅ Compiles cleanly (`tsc --noEmit`)

## Design Decisions

### Option A (Chosen): Dependency Injection via Constructor Config

**Pros:**

- Clean, idiomatic TypeScript
- No global state pollution
- Testable without environment modification
- Explicit contracts (config interface)
- Backwards compatible

**Cons:**

- Requires constructor signature change (minor breaking change)

### Option B (Rejected): Global Module Mock

**Example:** `vi.mock('@/clients/http')`

**Why Rejected:**

- Vitest module mocking affects all tests in the file
- Hard to mix real/mocked HTTP in different test cases
- Global state makes tests brittle

### Option C (Rejected): Environment Variables

**Example:** `process.env.HTTP_MOCK_MODE = 'true'`

**Why Rejected:**

- Side effects leak between tests
- Hard to reason about (implicit behavior)
- Couples production code to test concerns

## Integration Points

### Production Code Changes

| File                                     | Change                                                   | Impact                                        |
| ---------------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `src/clients/infojobs/infojobsClient.ts` | Constructor signature: `(config?: InfoJobsClientConfig)` | Production code still works (optional config) |
| `src/clients/infojobs/infojobsClient.ts` | Two `httpRequest` calls → `this.httpRequest`             | No functional change (internal refactor)      |

### Test Helpers

| File                        | Purpose              | Exports                                   |
| --------------------------- | -------------------- | ----------------------------------------- |
| `tests/helpers/mockHttp.ts` | HTTP mocking harness | `createMockHttp()` → `MockHttp` interface |

### Test Files

| File                                 | Tests | Purpose                                             |
| ------------------------------------ | ----- | --------------------------------------------------- |
| `tests/e2e/infojobs_offline.test.ts` | 3     | Prove InfoJobsClient works offline with mocked HTTP |

## Known Limitations

1. **Query Parameter Matching:** Mock matches only method + base URL, ignores query params
   - **Rationale:** Simple and sufficient for current needs
   - **Future Work:** Add `{ matchQuery: true }` option if needed

2. **Response Delay Simulation:** No artificial latency simulation
   - **Rationale:** E2E tests focus on correctness, not performance
   - **Future Work:** Add `{ delay: 100 }` option for timeout testing

3. **HTTP Error Responses:** Mock only supports success responses (200 OK)
   - **Rationale:** InfoJobsClient error handling tested separately
   - **Future Work:** Add `mock.onError(method, url, { status: 404 })` for error cases

## Next Steps (Future Work)

### Immediate (M1 Complete)

- ✅ HTTP mocking harness operational
- ✅ E2E offline tests passing
- ✅ All 85 tests passing

### Future Enhancements (Post-M1)

1. **Full Pipeline E2E Test:** Mock InfoJobs → ingest offers → verify DB state
2. **Error Case Coverage:** 404, 401, rate limits, network timeouts
3. **Mock Recording:** Capture real API calls → save as fixtures for future tests
4. **WebSocket Mocking:** If future providers need WebSocket support

## Success Criteria Met

- ✅ InfoJobsClient can be instantiated with mock HTTP
- ✅ Search and detail methods work offline with fixture data
- ✅ Canonical output shapes validated (company normalization, field mapping)
- ✅ No production code logic bugs found
- ✅ All tests pass (85/85)
- ✅ TypeScript compilation clean
- ✅ No network calls in E2E tests (verified by unmocked request test)

## Conclusion

The HTTP mocking harness provides a clean, maintainable foundation for E2E testing without network dependencies. The dependency injection approach keeps production code clean while enabling powerful test isolation.

**Verdict:** Production-ready. No breaking changes to production behavior. Test infrastructure robust and extensible.
