/**
 * Unit tests for repost detection (detectRepostDuplicate)
 *
 * Tests the pure deterministic duplicate detection logic.
 * Constructs candidates directly without DB access.
 *
 * No DB, no network, no time dependency, no side effects.
 */

import { describe, it, expect } from "vitest";
import { detectRepostDuplicate } from "@/signal/repost/repostDetection";
import { DESC_SIM_THRESHOLD } from "@/constants/repost";
import type { RepostCandidate } from "@/types/repost";

describe("detectRepostDuplicate", () => {
  // ============================================================================
  // Invariant 1: Empty candidates => not_duplicate (no_candidates)
  // ============================================================================
  it("should return not_duplicate when candidates array is empty", () => {
    const incoming = {
      title: "Senior Developer",
      description: "We are hiring a senior developer with 5 years experience.",
    };

    const result = detectRepostDuplicate(incoming, []);

    expect(result.kind).toBe("not_duplicate");
    expect(result.reason).toBe("no_candidates");
  });

  // ============================================================================
  // Invariant 2: Exact title match => duplicate (exact_title)
  // ============================================================================
  it("should detect duplicate via exact title match (case/punctuation tolerant, description optional)", () => {
    // Test: case differences, punctuation, missing description all work
    const incoming = {
      title: "FULL-STACK Developer (React/Node)",
      description: null, // Missing description OK for exact title match
    };

    const candidates: RepostCandidate[] = [
      {
        id: 1,
        title: "Different Title",
        description: "Something",
        publishedAt: "2024-01-09T10:00:00Z",
      },
      {
        id: 2,
        title: "full stack developer react node", // Matches after normalization
        description: "Different description",
        publishedAt: "2024-01-10T10:00:00Z",
      },
      {
        id: 3,
        title: "Full-Stack Developer (React/Node)", // Also matches
        description: "Another",
        publishedAt: "2024-01-11T10:00:00Z",
      },
    ];

    const result = detectRepostDuplicate(incoming, candidates);

    expect(result.kind).toBe("duplicate");
    if (result.kind === "duplicate") {
      expect(result.canonicalOfferId).toBe(2); // First exact match
      expect(result.reason).toBe("exact_title");
    }
  });

  // ============================================================================
  // Invariant 3: Missing description + no exact title => not_duplicate
  // ============================================================================
  it("should return not_duplicate when incoming description is missing and title does not match", () => {
    const incoming = {
      title: "Frontend Developer",
      description: "", // Empty (also covers null/whitespace)
    };

    const candidates: RepostCandidate[] = [
      {
        id: 50,
        title: "Backend Developer", // No exact title match
        description: "Looking for backend engineer",
        publishedAt: "2024-01-10T10:00:00Z",
      },
    ];

    const result = detectRepostDuplicate(incoming, candidates);

    expect(result.kind).toBe("not_duplicate");
    expect(result.reason).toBe("missing_description");
  });

  // ============================================================================
  // Invariant 4: Description similarity >= threshold => duplicate
  // ============================================================================
  it("should detect duplicate via description similarity (multiset overlap >= threshold)", () => {
    // Test multiset token counting (not simple set)
    const incoming = {
      title: "Position A",
      description: "python python python node node javascript", // 6 tokens with repetition
    };

    const candidates: RepostCandidate[] = [
      {
        id: 80,
        title: "Position B", // Different title
        description: "python python python node node javascript", // Identical multiset
        publishedAt: "2024-01-10T10:00:00Z",
      },
    ];

    const result = detectRepostDuplicate(incoming, candidates);

    expect(result.kind).toBe("duplicate");
    if (result.kind === "duplicate") {
      expect(result.canonicalOfferId).toBe(80);
      expect(result.reason).toBe("desc_similarity");
      expect(result.similarity).toBe(1.0); // Perfect match
    }
  });

  // ============================================================================
  // Invariant 5: Description similarity below threshold => not_duplicate
  // ============================================================================
  it("should return not_duplicate when description similarity is below threshold", () => {
    // 8/10 tokens shared = 0.80 < 0.90 threshold
    const incoming = {
      title: "Job X",
      description: "one two three four five six seven eight nine ten",
    };

    const candidates: RepostCandidate[] = [
      {
        id: 110,
        title: "Job Y",
        description: "one two three four five six seven eight DIFF1 DIFF2",
        publishedAt: "2024-01-10T10:00:00Z",
      },
    ];

    const result = detectRepostDuplicate(incoming, candidates);

    expect(result.kind).toBe("not_duplicate");
    // Note: reason will be "desc_below_threshold" or "title_mismatch" depending on overlap
  });

  // ============================================================================
  // Invariant 6: Candidate missing description is skipped safely
  // ============================================================================
  it("should skip candidates with missing descriptions and select valid ones", () => {
    const incoming = {
      title: "Engineer",
      description: "We need an experienced engineer with JavaScript skills",
    };

    const candidates: RepostCandidate[] = [
      {
        id: 130,
        title: "Developer",
        description: null, // No description - should skip
        publishedAt: "2024-01-10T10:00:00Z",
      },
      {
        id: 131,
        title: "Programmer",
        description: "", // Empty - should skip
        publishedAt: "2024-01-11T10:00:00Z",
      },
      {
        id: 132,
        title: "Coder",
        description: "We need an experienced engineer with JavaScript skills", // Valid match
        publishedAt: "2024-01-12T10:00:00Z",
      },
    ];

    const result = detectRepostDuplicate(incoming, candidates);

    expect(result.kind).toBe("duplicate");
    if (result.kind === "duplicate") {
      expect(result.canonicalOfferId).toBe(132); // Selected the valid one
      expect(result.similarity).toBe(1.0);
    }
  });

  // ============================================================================
  // Invariant 7: Tie-breaker - higher similarity wins
  // ============================================================================
  it("should select candidate with highest similarity when multiple above threshold", () => {
    const incoming = {
      title: "Offer",
      description: "one two three four five six seven eight nine ten",
    };

    const candidates: RepostCandidate[] = [
      {
        id: 160,
        title: "Candidate A",
        description: "one two three four five six seven eight nine DIFF", // 9/10 = 0.90
        publishedAt: "2024-01-10T10:00:00Z",
      },
      {
        id: 161,
        title: "Candidate B",
        description: "one two three four five six seven eight nine ten", // 10/10 = 1.0
        publishedAt: "2024-01-11T10:00:00Z",
      },
    ];

    const result = detectRepostDuplicate(incoming, candidates);

    expect(result.kind).toBe("duplicate");
    if (result.kind === "duplicate") {
      expect(result.canonicalOfferId).toBe(161); // Highest similarity
      expect(result.similarity).toBe(1.0);
    }
  });

  // ============================================================================
  // Invariant 8: Tie-breaker - timestamp priority hierarchy
  // ============================================================================
  it("should use timestamp priority (lastSeenAt > publishedAt > updatedAt) when similarity equal", () => {
    const incoming = {
      title: "Job",
      description: "skill1 skill2 skill3",
    };

    // Test 1: lastSeenAt priority
    const candidates1: RepostCandidate[] = [
      {
        id: 180,
        title: "Other",
        description: "skill1 skill2 skill3",
        lastSeenAt: "2024-01-10T10:00:00Z", // Older
        publishedAt: "2024-01-01T10:00:00Z",
      },
      {
        id: 181,
        title: "Another",
        description: "skill1 skill2 skill3",
        lastSeenAt: "2024-01-20T10:00:00Z", // More recent - should win
        publishedAt: "2024-01-01T10:00:00Z",
      },
    ];

    const result1 = detectRepostDuplicate(incoming, candidates1);
    expect(result1.kind).toBe("duplicate");
    if (result1.kind === "duplicate") {
      expect(result1.canonicalOfferId).toBe(181); // More recent lastSeenAt
    }

    // Test 2: publishedAt fallback when no lastSeenAt
    const candidates2: RepostCandidate[] = [
      {
        id: 190,
        title: "Pos A",
        description: "skill1 skill2 skill3",
        publishedAt: "2024-01-05T10:00:00Z",
      },
      {
        id: 191,
        title: "Pos B",
        description: "skill1 skill2 skill3",
        publishedAt: "2024-01-15T10:00:00Z", // More recent - should win
      },
    ];

    const result2 = detectRepostDuplicate(incoming, candidates2);
    expect(result2.kind).toBe("duplicate");
    if (result2.kind === "duplicate") {
      expect(result2.canonicalOfferId).toBe(191);
    }

    // Test 3: updatedAt fallback when no lastSeenAt/publishedAt
    const candidates3: RepostCandidate[] = [
      {
        id: 200,
        title: "Role A",
        description: "skill1 skill2 skill3",
        updatedAt: "2024-01-08T10:00:00Z",
      },
      {
        id: 201,
        title: "Role B",
        description: "skill1 skill2 skill3",
        updatedAt: "2024-01-18T10:00:00Z", // More recent - should win
      },
    ];

    const result3 = detectRepostDuplicate(incoming, candidates3);
    expect(result3.kind).toBe("duplicate");
    if (result3.kind === "duplicate") {
      expect(result3.canonicalOfferId).toBe(201);
    }
  });

  // ============================================================================
  // Invariant 8b: Tie-breaker - smallest id when timestamps equal/missing
  // ============================================================================
  it("should use smallest id as final tie-breaker when timestamps equal or missing", () => {
    const incoming = {
      title: "Opening",
      description: "tool1 tool2 tool3",
    };

    // Test 1: Equal timestamps
    const candidates1: RepostCandidate[] = [
      {
        id: 230,
        title: "Open A",
        description: "tool1 tool2 tool3",
        publishedAt: "2024-01-10T10:00:00Z",
      },
      {
        id: 220,
        title: "Open B",
        description: "tool1 tool2 tool3",
        publishedAt: "2024-01-10T10:00:00Z", // Same timestamp
      },
    ];

    const result1 = detectRepostDuplicate(incoming, candidates1);
    expect(result1.kind).toBe("duplicate");
    if (result1.kind === "duplicate") {
      expect(result1.canonicalOfferId).toBe(220); // Smaller id
    }

    // Test 2: No timestamps at all
    const candidates2: RepostCandidate[] = [
      {
        id: 250,
        title: "Vac A",
        description: "tool1 tool2 tool3",
      },
      {
        id: 240,
        title: "Vac B",
        description: "tool1 tool2 tool3",
      },
    ];

    const result2 = detectRepostDuplicate(incoming, candidates2);
    expect(result2.kind).toBe("duplicate");
    if (result2.kind === "duplicate") {
      expect(result2.canonicalOfferId).toBe(240); // Smaller id
    }
  });
});
