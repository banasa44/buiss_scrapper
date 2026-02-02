/**
 * Unit tests for negation detection logic
 *
 * Tests the isNegated function used by the M3 matcher
 * to detect negated keyword/phrase contexts.
 *
 * No DB, no network, no side effects
 */

import { describe, it, expect } from "vitest";
import { isNegated } from "@/signal/matcher/negation";
import {
  NEGATION_WINDOW_BEFORE,
  NEGATION_WINDOW_AFTER,
} from "@/constants/negation";

describe("isNegated", () => {
  describe("negation cue BEFORE match (within window)", () => {
    it("should detect negation immediately before match", () => {
      // "no aws experience"
      const tokens = ["no", "aws", "experience"];
      expect(isNegated(tokens, 1, 1)).toBe(true);
    });

    it("should detect negation with Spanish cue 'sin'", () => {
      // "sin experiencia aws"
      const tokens = ["sin", "experiencia", "aws"];
      expect(isNegated(tokens, 2, 1)).toBe(true);
    });

    it("should detect negation at window boundary (BEFORE = 8)", () => {
      // Cue at exactly 8 tokens before match start (within window)
      const tokens = ["no", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "aws"];
      expect(isNegated(tokens, 8, 1)).toBe(true);
    });
  });

  describe("negation cue BEFORE match (outside window)", () => {
    it("should NOT detect negation beyond BEFORE window", () => {
      // Cue at 9 tokens before match start (outside window of 8)
      const tokens = [
        "no",
        "t1",
        "t2",
        "t3",
        "t4",
        "t5",
        "t6",
        "t7",
        "t8",
        "aws",
      ];
      expect(isNegated(tokens, 9, 1)).toBe(false);
    });
  });

  describe("negation cue AFTER match (within window)", () => {
    it("should detect negation immediately after match", () => {
      // "aws not required"
      const tokens = ["aws", "not", "required"];
      expect(isNegated(tokens, 0, 1)).toBe(true);
    });

    it("should detect negation at window boundary (AFTER = 2)", () => {
      // Cue at exactly 2 tokens after match end (within window)
      const tokens = ["aws", "t1", "not"];
      expect(isNegated(tokens, 0, 1)).toBe(true);
    });
  });

  describe("negation cue AFTER match (outside window)", () => {
    it("should NOT detect negation beyond AFTER window", () => {
      // Cue at 3 tokens after match end (outside window of 2)
      const tokens = ["aws", "t1", "t2", "not"];
      expect(isNegated(tokens, 0, 1)).toBe(false);
    });
  });

  describe("multi-token match span handling", () => {
    it("should handle multi-token match with negation before", () => {
      // "no full stack experience"
      const tokens = ["no", "full", "stack", "experience"];
      expect(isNegated(tokens, 1, 2)).toBe(true); // "full stack" at index 1, length 2
    });

    it("should handle multi-token match with negation after", () => {
      // "full stack not required"
      const tokens = ["full", "stack", "not", "required"];
      expect(isNegated(tokens, 0, 2)).toBe(true); // "full stack" at index 0, length 2
    });

    it("should exclude match tokens themselves from negation check", () => {
      // "aws no experience" - "no" is at index 1, part of a hypothetical match [1,2]
      // The match tokens themselves should be excluded from negation check
      const tokens = ["aws", "no", "experience"];
      expect(isNegated(tokens, 1, 2)).toBe(false); // match covers "no experience", so "no" is excluded
    });
  });

  describe("list negation scenarios", () => {
    it("should detect negation in list context", () => {
      // "no aws gcp or azure required"
      // Tests current behavior: negation cue affects all nearby matches
      const tokens = ["no", "aws", "gcp", "or", "azure", "required"];

      // Each technology is checked independently
      expect(isNegated(tokens, 1, 1)).toBe(true); // aws
      expect(isNegated(tokens, 2, 1)).toBe(true); // gcp
      expect(isNegated(tokens, 4, 1)).toBe(true); // azure
    });
  });

  describe("edge cases", () => {
    it("should handle match at start of token array", () => {
      // "aws experience"
      const tokens = ["aws", "experience"];
      expect(isNegated(tokens, 0, 1)).toBe(false);
    });

    it("should handle match at end of token array", () => {
      // "experience aws"
      const tokens = ["experience", "aws"];
      expect(isNegated(tokens, 1, 1)).toBe(false);
    });

    it("should handle single-token array", () => {
      const tokens = ["aws"];
      expect(isNegated(tokens, 0, 1)).toBe(false);
    });

    it("should handle all negation cue types", () => {
      // Test each cue type: no, sin, not, without
      expect(isNegated(["no", "aws"], 1, 1)).toBe(true);
      expect(isNegated(["sin", "aws"], 1, 1)).toBe(true);
      expect(isNegated(["not", "aws"], 1, 1)).toBe(true);
      expect(isNegated(["without", "aws"], 1, 1)).toBe(true);
    });
  });

  describe("window boundary validation", () => {
    it("should respect BEFORE window size constant", () => {
      // Build tokens array with cue at exactly NEGATION_WINDOW_BEFORE distance
      const beforeTokens = Array(NEGATION_WINDOW_BEFORE).fill("filler");
      const tokens = ["no", ...beforeTokens, "aws"];

      // Cue at index 0, match at index NEGATION_WINDOW_BEFORE + 1
      // Distance = NEGATION_WINDOW_BEFORE + 1 - 0 = NEGATION_WINDOW_BEFORE + 1 (outside)
      expect(isNegated(tokens, NEGATION_WINDOW_BEFORE + 1, 1)).toBe(false);

      // Now test at boundary (cue at distance exactly NEGATION_WINDOW_BEFORE)
      const tokensAtBoundary = [
        "no",
        ...Array(NEGATION_WINDOW_BEFORE - 1).fill("filler"),
        "aws",
      ];
      expect(isNegated(tokensAtBoundary, NEGATION_WINDOW_BEFORE, 1)).toBe(true);
    });

    it("should respect AFTER window size constant", () => {
      // Match at index 0, cue at distance NEGATION_WINDOW_AFTER + 1 (outside)
      const afterTokens = Array(NEGATION_WINDOW_AFTER + 1).fill("filler");
      const tokens = ["aws", ...afterTokens, "not"];
      expect(isNegated(tokens, 0, 1)).toBe(false);

      // Now test at boundary (cue at distance exactly NEGATION_WINDOW_AFTER)
      const tokensAtBoundary = [
        "aws",
        ...Array(NEGATION_WINDOW_AFTER - 1).fill("filler"),
        "not",
      ];
      expect(isNegated(tokensAtBoundary, 0, 1)).toBe(true);
    });
  });
});
