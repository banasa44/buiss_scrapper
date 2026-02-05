/**
 * Unit tests for Feedback Validation and classification logic
 *
 * Tests pure, deterministic classification of feedback changes by lifecycle impact.
 * Validates the core M6 decision logic for destructive/reversal/informational transitions.
 *
 * No DB, no network, no Google API calls
 */

import { describe, it, expect } from "vitest";
import { validateFeedbackChangePlan } from "@/sheets/feedbackValidation";
import type { FeedbackChangePlan } from "@/types";

/**
 * Helper: Create a minimal FeedbackChangePlan for testing
 */
function createTestPlan(
  overrides: Partial<FeedbackChangePlan> = {},
): FeedbackChangePlan {
  return {
    changes: [],
    totalSheetRows: 0,
    knownCompanyIds: 0,
    unknownCompanyIds: 0,
    changesDetected: 0,
    unchanged: 0,
    invalidRows: 0,
    ...overrides,
  };
}

describe("Feedback Validation and Classification", () => {
  describe("validateFeedbackChangePlan - destructive changes", () => {
    it("should classify transitions TO resolved states as destructive", () => {
      // Setup: transitions from active/null states TO resolved states
      const plan = createTestPlan({
        changes: [
          {
            companyId: 1,
            fromResolution: null, // null → ACCEPTED
            toResolution: "ACCEPTED",
          },
          {
            companyId: 2,
            fromResolution: "PENDING", // PENDING → REJECTED
            toResolution: "REJECTED",
          },
          {
            companyId: 3,
            fromResolution: "IN_PROGRESS", // IN_PROGRESS → ALREADY_REVOLUT
            toResolution: "ALREADY_REVOLUT",
          },
        ],
        changesDetected: 3,
      });

      const result = validateFeedbackChangePlan(plan);

      // Assert: all three should be classified as destructive
      expect(result.destructiveCount).toBe(3);
      expect(result.reversalCount).toBe(0);
      expect(result.informationalCount).toBe(0);
      expect(result.totalChanges).toBe(3);

      // Verify changes are in destructive category
      expect(result.destructiveChanges).toHaveLength(3);
      expect(result.destructiveChanges[0].classification).toBe("destructive");
      expect(result.destructiveChanges[0].companyId).toBe(1);
      expect(result.destructiveChanges[1].classification).toBe("destructive");
      expect(result.destructiveChanges[1].companyId).toBe(2);
      expect(result.destructiveChanges[2].classification).toBe("destructive");
      expect(result.destructiveChanges[2].companyId).toBe(3);

      // Verify sorting by companyId (determinism)
      expect(result.destructiveChanges[0].companyId).toBeLessThan(
        result.destructiveChanges[1].companyId,
      );
      expect(result.destructiveChanges[1].companyId).toBeLessThan(
        result.destructiveChanges[2].companyId,
      );
    });
  });

  describe("validateFeedbackChangePlan - reversal changes", () => {
    it("should classify transitions FROM resolved states as reversal", () => {
      // Setup: transitions from resolved states back TO active states
      const plan = createTestPlan({
        changes: [
          {
            companyId: 5,
            fromResolution: "ACCEPTED", // ACCEPTED → PENDING (reversal)
            toResolution: "PENDING",
          },
          {
            companyId: 6,
            fromResolution: "REJECTED", // REJECTED → IN_PROGRESS (reversal)
            toResolution: "IN_PROGRESS",
          },
          {
            companyId: 7,
            fromResolution: "ALREADY_REVOLUT", // ALREADY_REVOLUT → HIGH_INTEREST (reversal)
            toResolution: "HIGH_INTEREST",
          },
        ],
        changesDetected: 3,
      });

      const result = validateFeedbackChangePlan(plan);

      // Assert: all three should be classified as reversal
      expect(result.reversalCount).toBe(3);
      expect(result.destructiveCount).toBe(0);
      expect(result.informationalCount).toBe(0);
      expect(result.totalChanges).toBe(3);

      // Verify changes are in reversal category
      expect(result.reversalChanges).toHaveLength(3);
      expect(result.reversalChanges[0].classification).toBe("reversal");
      expect(result.reversalChanges[0].companyId).toBe(5);
      expect(result.reversalChanges[1].classification).toBe("reversal");
      expect(result.reversalChanges[1].companyId).toBe(6);
      expect(result.reversalChanges[2].classification).toBe("reversal");
      expect(result.reversalChanges[2].companyId).toBe(7);

      // Verify sorting by companyId (determinism)
      expect(result.reversalChanges[0].companyId).toBeLessThan(
        result.reversalChanges[1].companyId,
      );
      expect(result.reversalChanges[1].companyId).toBeLessThan(
        result.reversalChanges[2].companyId,
      );
    });
  });
});
