/**
 * M7 Client Pause Smoke Test
 *
 * Verifies persistent client pause behavior:
 * - Set pause -> paused -> clear -> not paused
 * - Auto-clear on expiry
 * - Reason tracking
 *
 * This test confirms client pause persistence without testing exact timestamps.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHarness } from "../../helpers/testDb";
import {
  getClientPause,
  setClientPause,
  clearClientPause,
  isClientPaused,
} from "@/db";

describe("M7 Client Pause Smoke Test", () => {
  let harness: TestDbHarness | null = null;

  afterEach(() => {
    if (harness) {
      harness.cleanup();
      harness = null;
    }
  });

  it("should set pause -> paused -> clear -> not paused", async () => {
    harness = await createTestDb();

    const client = "infojobs";

    // 1) Ensure no pause exists initially
    let pause = getClientPause(client);
    expect(pause).toBeNull();
    expect(isClientPaused(client)).toBe(false);

    // 2) Set pause with future timestamp
    const futureTimestamp = "2026-12-31T23:59:59Z";
    setClientPause(client, futureTimestamp, { reason: "RATE_LIMIT" });

    // 3) Assert pause is active
    pause = getClientPause(client);
    expect(pause).not.toBeNull();
    expect(pause?.client).toBe(client);
    expect(pause?.reason).toBe("RATE_LIMIT");
    expect(pause?.paused_until).toBe(futureTimestamp);
    expect(isClientPaused(client)).toBe(true);

    // 4) Clear pause
    clearClientPause(client);

    // 5) Assert pause is cleared
    pause = getClientPause(client);
    expect(pause).toBeNull();
    expect(isClientPaused(client)).toBe(false);
  });

  it("should auto-clear expired pauses", async () => {
    harness = await createTestDb();

    const client = "infojobs";

    // Set pause with past timestamp (expired)
    const pastTimestamp = "2020-01-01T00:00:00Z";
    setClientPause(client, pastTimestamp, { reason: "EXPIRED_TEST" });

    // Verify record was created
    let pause = getClientPause(client);
    expect(pause).not.toBeNull();
    expect(pause?.client).toBe(client);

    // Check if paused - should auto-clear and return false
    const isPaused = isClientPaused(client);
    expect(isPaused).toBe(false);

    // Verify record was removed
    pause = getClientPause(client);
    expect(pause).toBeNull();
  });
});
