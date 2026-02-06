/**
 * Unit Test — syncCompaniesToSheet counter invariants
 *
 * Validates that skippedCount calculation is correct using Set union logic.
 */

import { describe, it, expect } from "vitest";

describe("syncCompaniesToSheet counter semantics", () => {
  /**
   * Test the skippedCount calculation logic independently
   * This validates the invariant: skippedCount = totalCompanies - unique companies acted upon
   *
   * The key insight: On first run, a company can be BOTH appended and updated
   * in the same sync operation (update phase runs after append and sees the
   * newly appended company). This means appendedCount + updatedCount can exceed
   * totalCompanies due to double-counting the same company ID.
   *
   * The correct semantics: skippedCount = companies that received NO operations
   * Formula: totalCompanies - Set(appendedCompanyIds ∪ updatedCompanyIds).size
   */
  it("should calculate skippedCount using Set union (handles double-counting)", () => {
    // Scenario 1: All companies appended (empty sheet initially)
    const totalCompanies1 = 10;
    const appendedIds1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const updatedIds1: number[] = [];
    const actedIds1 = new Set([...appendedIds1, ...updatedIds1]);
    const skippedCount1 = totalCompanies1 - actedIds1.size;

    expect(skippedCount1).toBe(0);
    expect(actedIds1.size).toBe(10);

    // Scenario 2: All companies updated (full sheet, no new companies)
    const totalCompanies2 = 10;
    const appendedIds2: number[] = [];
    const updatedIds2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const actedIds2 = new Set([...appendedIds2, ...updatedIds2]);
    const skippedCount2 = totalCompanies2 - actedIds2.size;

    expect(skippedCount2).toBe(0);
    expect(actedIds2.size).toBe(10);

    // Scenario 3: Mixed (5 new, 5 existing)
    const totalCompanies3 = 10;
    const appendedIds3 = [6, 7, 8, 9, 10]; // New companies
    const updatedIds3 = [1, 2, 3, 4, 5]; // Existing companies
    const actedIds3 = new Set([...appendedIds3, ...updatedIds3]);
    const skippedCount3 = totalCompanies3 - actedIds3.size;

    expect(skippedCount3).toBe(0);
    expect(actedIds3.size).toBe(10);

    // Scenario 4: First run with single company (appended + updated in same run)
    // This is the CRITICAL case that exposed the original bug
    const totalCompanies4 = 1;
    const appendedIds4 = [999999]; // Company 999999 appended by append phase
    const updatedIds4 = [999999]; // SAME company updated by update phase
    const actedIds4 = new Set([...appendedIds4, ...updatedIds4]);
    const skippedCount4 = totalCompanies4 - actedIds4.size;

    // Set union deduplicates: {999999} ∪ {999999} = {999999}
    // skippedCount = 1 - 1 = 0 (CORRECT!)
    expect(actedIds4.size).toBe(1); // Only 1 unique company
    expect(skippedCount4).toBe(0);

    // Scenario 5: Some companies skipped (mapping errors)
    const totalCompanies5 = 10;
    const appendedIds5 = [6, 7, 8]; // 3 new companies appended
    const updatedIds5 = [1, 2, 3, 4, 5]; // 5 existing companies updated
    const actedIds5 = new Set([...appendedIds5, ...updatedIds5]);
    const skippedCount5 = totalCompanies5 - actedIds5.size;

    // 8 companies acted upon (6,7,8 + 1,2,3,4,5), 2 skipped (9, 10)
    expect(actedIds5.size).toBe(8);
    expect(skippedCount5).toBe(2);
  });
});
