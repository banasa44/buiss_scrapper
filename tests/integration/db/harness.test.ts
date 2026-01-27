/**
 * DB Harness Smoke Test
 *
 * Verifies that the test database harness works correctly:
 * - Creates a fresh DB
 * - Runs real migrations
 * - Repos work with the test DB
 * - Cleanup removes the temp file
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "fs";
import { createTestDb, type TestDbHarness } from "../../helpers/testDb";
import { createRun, getRunById } from "@/db";

describe("Test DB Harness", () => {
  let harness: TestDbHarness | null = null;

  afterEach(() => {
    // Ensure cleanup runs even if test fails
    if (harness) {
      harness.cleanup();
      harness = null;
    }
  });

  it("should create a fresh database with migrations applied", async () => {
    harness = await createTestDb();

    // Verify DB file exists
    expect(existsSync(harness.dbPath)).toBe(true);

    // Verify migrations ran (schema_migrations table should exist and have entries)
    const migrations = harness.db
      .prepare("SELECT * FROM schema_migrations")
      .all();
    expect(migrations.length).toBeGreaterThan(0);
  });

  it("should allow repos to work with the test database", async () => {
    harness = await createTestDb();

    // Create a run using the repo (which uses getDb() internally)
    const runId = createRun({
      provider: "test-provider",
      query_fingerprint: "test-fingerprint",
    });

    expect(runId).toBeGreaterThan(0);

    // Retrieve it back
    const run = getRunById(runId);
    expect(run).toBeDefined();
    expect(run?.provider).toBe("test-provider");
    expect(run?.query_fingerprint).toBe("test-fingerprint");
    expect(run?.status).toBeNull(); // Not finished yet
  });

  it("should clean up temp file after cleanup()", async () => {
    harness = await createTestDb();
    const dbPath = harness.dbPath;

    // Verify file exists before cleanup
    expect(existsSync(dbPath)).toBe(true);

    // Run cleanup
    harness.cleanup();
    harness = null;

    // Verify file is deleted
    expect(existsSync(dbPath)).toBe(false);
  });
});
