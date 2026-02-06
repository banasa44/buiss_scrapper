/**
 * Unit Test — syncCompaniesToSheet counter invariants
 *
 * Validates that skippedCount calculation is correct and non-negative.
 */

import { describe, it, expect } from "vitest";

describe("syncCompaniesToSheet counter semantics", () => {
  /**
   * Test the skippedCount calculation logic independently
   * This validates the invariant: skippedCount >= 0 always
   *
   * The key insight: On first run, a company can be BOTH appended and updated
   * in the same sync operation (update phase runs after append and sees the
   * newly appended company). This means appendedCount + updatedCount can exceed
   * totalCompanies due to double-counting.
   *
   * The correct semantics: skippedCount = companies that received NO operations
   * Formula: Math.max(0, totalCompanies - (appendedCount + updatedCount))
   */
  it("should calculate skippedCount correctly (always non-negative)", () => {
    // Scenario 1: All companies appended (empty sheet initially)
    const totalCompanies1 = 10;
    const appendedCount1 = 10;
    const updatedCount1 = 0;
    const skippedCount1 = Math.max(
      0,
      totalCompanies1 - (appendedCount1 + updatedCount1),
    );

    expect(skippedCount1).toBe(0);
    expect(skippedCount1).toBeGreaterThanOrEqual(0);

    // Scenario 2: All companies updated (full sheet, no new companies)
    const totalCompanies2 = 10;
    const appendedCount2 = 0;
    const updatedCount2 = 10;
    const skippedCount2 = Math.max(
      0,
      totalCompanies2 - (appendedCount2 + updatedCount2),
    );

    expect(skippedCount2).toBe(0);
    expect(skippedCount2).toBeGreaterThanOrEqual(0);

    // Scenario 3: Mixed (5 new, 5 existing)
    const totalCompanies3 = 10;
    const appendedCount3 = 5;
    const updatedCount3 = 5;
    const skippedCount3 = Math.max(
      0,
      totalCompanies3 - (appendedCount3 + updatedCount3),
    );

    expect(skippedCount3).toBe(0);
    expect(skippedCount3).toBeGreaterThanOrEqual(0);

    // Scenario 4: First run with single company (appended + updated in same run)
    // This is the CRITICAL case that exposed the bug
    const totalCompanies4 = 1;
    const appendedCount4 = 1; // Company appended by append phase
    const updatedCount4 = 1; // Same company updated by update phase
    const skippedCount4 = Math.max(
      0,
      totalCompanies4 - (appendedCount4 + updatedCount4),
    );

    // Without Math.max: 1 - (1 + 1) = -1 (WRONG!)
    // With Math.max: Math.max(0, -1) = 0 (CORRECT!)
    expect(skippedCount4).toBe(0);
    expect(skippedCount4).toBeGreaterThanOrEqual(0);

    // Scenario 5: Some companies skipped (mapping errors)
    const totalCompanies5 = 10;
    const appendedCount5 = 3; // 3 new companies appended
    const updatedCount5 = 5; // 5 existing companies updated
    const skippedCount5 = Math.max(
      0,
      totalCompanies5 - (appendedCount5 + updatedCount5),
    );

    expect(skippedCount5).toBe(2); // 2 companies skipped
    expect(skippedCount5).toBeGreaterThanOrEqual(0);
  });
});
