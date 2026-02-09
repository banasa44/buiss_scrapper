/**
 * M7 Schema Smoke Test
 *
 * Verifies that M7 migrations produced the expected schema:
 * - Tables: query_state, run_lock, client_pause
 * - Column: ingestion_runs.query_fingerprint
 *
 * This test confirms that M7 schema changes are correctly applied
 * without testing the business logic (that belongs in unit tests).
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHarness } from "../../helpers/testDb";

describe("M7 Schema Smoke Test", () => {
  let harness: TestDbHarness | null = null;

  afterEach(() => {
    if (harness) {
      harness.cleanup();
      harness = null;
    }
  });

  it("should have M7 tables: query_state, run_lock, client_pause", async () => {
    harness = await createTestDb();

    // Query sqlite_master for all tables
    const tables = harness.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    // Assert M7 tables exist
    expect(tableNames).toContain("query_state");
    expect(tableNames).toContain("run_lock");
    expect(tableNames).toContain("client_pause");
  });

  it("should have query_fingerprint column in ingestion_runs table", async () => {
    harness = await createTestDb();

    // Query table schema using PRAGMA
    const columns = harness.db
      .prepare("PRAGMA table_info(ingestion_runs)")
      .all() as { name: string; type: string }[];

    const columnNames = columns.map((c) => c.name);

    // Assert query_fingerprint column exists
    expect(columnNames).toContain("query_fingerprint");
  });
});
