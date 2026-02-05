/**
 * Unit tests for Feedback Window gate logic
 *
 * Tests pure, deterministic time-based gating for feedback processing.
 * Uses explicit Date objects to ensure timezone-independent behavior.
 *
 * No DB, no network, no Google API calls
 */

import { describe, it, expect } from "vitest";
import {
  isWithinFeedbackWindow,
  shouldRunFeedbackIngestion,
} from "@/sheets/feedbackWindow";
import {
  FEEDBACK_WINDOW_START_HOUR,
  FEEDBACK_WINDOW_END_HOUR,
  FEEDBACK_WINDOW_TIMEZONE,
} from "@/constants";

describe("Feedback Window Gate", () => {
  describe("isWithinFeedbackWindow", () => {
    it("should allow processing within window boundaries (03:00-05:59 Madrid time)", () => {
      // Create dates that will be 03:00, 04:00, 05:00 in Europe/Madrid
      // Using UTC dates that correspond to Madrid timezone during standard time (UTC+1)
      const madridStartHour = new Date("2026-02-05T02:00:00Z"); // 03:00 Madrid
      const madridMidWindow = new Date("2026-02-05T04:00:00Z"); // 05:00 Madrid
      const madridEndHour = new Date("2026-02-05T04:59:59Z"); // 05:59:59 Madrid

      expect(isWithinFeedbackWindow(madridStartHour)).toBe(true);
      expect(isWithinFeedbackWindow(madridMidWindow)).toBe(true);
      expect(isWithinFeedbackWindow(madridEndHour)).toBe(true);
    });

    it("should block processing outside window boundaries", () => {
      // Times just outside the window
      const beforeWindow = new Date("2026-02-05T01:59:59Z"); // 02:59:59 Madrid
      const afterWindow = new Date("2026-02-05T05:00:00Z"); // 06:00:00 Madrid

      expect(isWithinFeedbackWindow(beforeWindow)).toBe(false);
      expect(isWithinFeedbackWindow(afterWindow)).toBe(false);
    });
  });

  describe("shouldRunFeedbackIngestion", () => {
    it("should return structured allowed result within window", () => {
      const withinWindow = new Date("2026-02-05T02:30:00Z"); // 03:30 Madrid

      const result = shouldRunFeedbackIngestion(withinWindow);

      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("Within feedback window");
      expect(result.reason).toContain(
        `${FEEDBACK_WINDOW_START_HOUR}:00-${FEEDBACK_WINDOW_END_HOUR}:00`,
      );
      expect(result.reason).toContain(FEEDBACK_WINDOW_TIMEZONE);
      expect(result.currentHour).toBeGreaterThanOrEqual(
        FEEDBACK_WINDOW_START_HOUR,
      );
      expect(result.currentHour).toBeLessThan(FEEDBACK_WINDOW_END_HOUR);
      expect(result.timezone).toBe(FEEDBACK_WINDOW_TIMEZONE);
    });

    it("should return structured blocked result outside window", () => {
      const outsideWindow = new Date("2026-02-05T10:00:00Z"); // 11:00 Madrid

      const result = shouldRunFeedbackIngestion(outsideWindow);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Outside feedback window");
      expect(result.reason).toContain("current hour");
      expect(result.currentHour).toBeDefined();
      expect(result.timezone).toBe(FEEDBACK_WINDOW_TIMEZONE);
    });
  });
});
