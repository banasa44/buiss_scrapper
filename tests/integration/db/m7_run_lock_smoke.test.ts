/**
 * M7 Run Lock Smoke Test
 *
 * Verifies run lock behavior:
 * - Single owner enforcement
 * - Acquire/refresh/release lifecycle
 * - Lock contention handling
 *
 * This test confirms run lock semantics without testing TTL expiry
 * or wall-clock timing (that belongs in separate tests).
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHarness } from "../../helpers/testDb";
import {
  acquireRunLock,
  refreshRunLock,
  releaseRunLock,
  getRunLock,
} from "@/db";

describe("M7 Run Lock Smoke Test", () => {
  let harness: TestDbHarness | null = null;

  afterEach(() => {
    if (harness) {
      harness.cleanup();
      harness = null;
    }
  });

  it("should enforce single owner and allow release/reacquisition", async () => {
    harness = await createTestDb();

    const ownerA = "owner-a-uuid";
    const ownerB = "owner-b-uuid";

    // 1) Acquire lock with ownerA -> expect { ok: true }
    const acquireA1 = acquireRunLock(ownerA);
    expect(acquireA1).toEqual({ ok: true });

    // Verify lock is held by ownerA
    const lock1 = getRunLock();
    expect(lock1).not.toBeNull();
    expect(lock1?.owner_id).toBe(ownerA);

    // 2) Acquire lock with ownerB -> expect { ok: false, reason: "LOCKED" }
    const acquireB1 = acquireRunLock(ownerB);
    expect(acquireB1).toEqual({ ok: false, reason: "LOCKED" });

    // 3) Refresh with ownerB -> expect false
    const refreshB = refreshRunLock(ownerB);
    expect(refreshB).toBe(false);

    // 4) Release with ownerB -> expect false
    const releaseB1 = releaseRunLock(ownerB);
    expect(releaseB1).toBe(false);

    // 5) Refresh with ownerA -> expect true (lock still held)
    const refreshA = refreshRunLock(ownerA);
    expect(refreshA).toBe(true);

    // 6) Release with ownerA -> expect true
    const releaseA = releaseRunLock(ownerA);
    expect(releaseA).toBe(true);

    // Verify lock is now released
    const lock2 = getRunLock();
    expect(lock2).toBeNull();

    // 7) Acquire with ownerB after release -> expect { ok: true }
    const acquireB2 = acquireRunLock(ownerB);
    expect(acquireB2).toEqual({ ok: true });

    // Verify lock is held by ownerB
    const lock3 = getRunLock();
    expect(lock3).not.toBeNull();
    expect(lock3?.owner_id).toBe(ownerB);

    // 8) Cleanup: release lock with ownerB
    const releaseB2 = releaseRunLock(ownerB);
    expect(releaseB2).toBe(true);

    // Final verification: lock is fully released
    const lock4 = getRunLock();
    expect(lock4).toBeNull();
  });
});
