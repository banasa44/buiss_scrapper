/**
 * M7 Query State Smoke Test
 *
 * Verifies query state persistence and state transitions:
 * - IDLE -> RUNNING -> ERROR -> SUCCESS
 * - Consecutive failures counter
 * - Error details persistence
 * - Last processed date tracking
 *
 * This test confirms query state lifecycle without testing exact timestamps.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHarness } from "../../helpers/testDb";
import {
  upsertQueryState,
  getQueryState,
  markQueryRunning,
  markQueryError,
  markQuerySuccess,
} from "@/db";

describe("M7 Query State Smoke Test", () => {
  let harness: TestDbHarness | null = null;

  afterEach(() => {
    if (harness) {
      harness.cleanup();
      harness = null;
    }
  });

  it("should transition IDLE -> RUNNING -> ERROR -> SUCCESS with counters", async () => {
    harness = await createTestDb();

    const queryKey = "test:query:abc";

    // 1) Upsert initial row with IDLE status
    upsertQueryState({
      query_key: queryKey,
      client: "infojobs",
      name: "test_query",
      status: "IDLE",
    });

    let state = getQueryState(queryKey);
    expect(state).not.toBeNull();
    expect(state?.status).toBe("IDLE");
    expect(state?.client).toBe("infojobs");
    expect(state?.name).toBe("test_query");
    expect(state?.consecutive_failures).toBe(0);

    // 2) Mark query as RUNNING
    markQueryRunning(queryKey);

    state = getQueryState(queryKey);
    expect(state).not.toBeNull();
    expect(state?.status).toBe("RUNNING");
    expect(state?.last_run_at).not.toBeNull();
    expect(state?.last_run_at).toBeDefined();

    // 3) Mark query as ERROR with details
    markQueryError(queryKey, undefined, {
      errorCode: "TEST",
      errorMessage: "boom",
    });

    state = getQueryState(queryKey);
    expect(state).not.toBeNull();
    expect(state?.status).toBe("ERROR");
    expect(state?.consecutive_failures).toBeGreaterThanOrEqual(1);
    expect(state?.error_code).toBe("TEST");
    expect(state?.error_message).toContain("boom");
    expect(state?.last_error_at).not.toBeNull();
    expect(state?.last_error_at).toBeDefined();

    // 4) Mark query as SUCCESS with last processed date
    markQuerySuccess(queryKey, undefined, {
      lastProcessedDate: "2026-02-09",
    });

    state = getQueryState(queryKey);
    expect(state).not.toBeNull();
    expect(state?.status).toBe("SUCCESS");
    expect(state?.consecutive_failures).toBe(0);
    expect(state?.last_success_at).not.toBeNull();
    expect(state?.last_success_at).toBeDefined();
    expect(state?.last_processed_date).toBe("2026-02-09");
    // Error fields should be cleared
    expect(state?.error_code).toBeNull();
    expect(state?.error_message).toBeNull();
  });
});
