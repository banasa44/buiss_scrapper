/**
 * Unit tests for offer content fingerprinting
 *
 * Tests the deterministic fingerprint computation function.
 */

import { describe, it, expect } from "vitest";
import { computeOfferFingerprint } from "@/signal/repost/offerFingerprint";

describe("computeOfferFingerprint", () => {
  describe("determinism", () => {
    it("should produce identical fingerprints for identical content", () => {
      const offer1 = {
        title: "Senior Developer",
        description:
          "We are looking for a senior developer with 5 years of experience in TypeScript and Node.js.",
      };

      const offer2 = {
        title: "Senior Developer",
        description:
          "We are looking for a senior developer with 5 years of experience in TypeScript and Node.js.",
      };

      const fp1 = computeOfferFingerprint(offer1);
      const fp2 = computeOfferFingerprint(offer2);

      expect(fp1).not.toBeNull();
      expect(fp2).not.toBeNull();
      expect(fp1).toBe(fp2);
    });

    it("should produce identical fingerprints regardless of casing", () => {
      const offer1 = {
        title: "Senior Developer",
        description: "We need TypeScript experience.",
      };

      const offer2 = {
        title: "SENIOR DEVELOPER",
        description: "we need typescript experience.",
      };

      const fp1 = computeOfferFingerprint(offer1);
      const fp2 = computeOfferFingerprint(offer2);

      expect(fp1).toBe(fp2);
    });

    it("should produce identical fingerprints regardless of whitespace variations", () => {
      const offer1 = {
        title: "Senior Developer",
        description: "We need   TypeScript    experience.",
      };

      const offer2 = {
        title: "Senior   Developer",
        description: "We need TypeScript experience.",
      };

      const fp1 = computeOfferFingerprint(offer1);
      const fp2 = computeOfferFingerprint(offer2);

      expect(fp1).toBe(fp2);
    });

    it("should produce identical fingerprints regardless of diacritics", () => {
      const offer1 = {
        title: "Desarrollador Senior",
        description: "Necesitamos experiencia en TypeScript.",
      };

      const offer2 = {
        title: "Desarrollador Sénior",
        description: "Necesitamos experiéncia en TypeScript.",
      };

      const fp1 = computeOfferFingerprint(offer1);
      const fp2 = computeOfferFingerprint(offer2);

      expect(fp1).toBe(fp2);
    });

    it("should produce different fingerprints for different content", () => {
      const offer1 = {
        title: "Senior Developer",
        description: "We need TypeScript experience.",
      };

      const offer2 = {
        title: "Senior Developer",
        description: "We need Python experience.",
      };

      const fp1 = computeOfferFingerprint(offer1);
      const fp2 = computeOfferFingerprint(offer2);

      expect(fp1).not.toBe(fp2);
    });

    it("should produce different fingerprints for different titles even with same description", () => {
      const offer1 = {
        title: "Senior Developer",
        description: "We need TypeScript experience.",
      };

      const offer2 = {
        title: "Junior Developer",
        description: "We need TypeScript experience.",
      };

      const fp1 = computeOfferFingerprint(offer1);
      const fp2 = computeOfferFingerprint(offer2);

      expect(fp1).not.toBe(fp2);
    });
  });

  describe("missing data handling", () => {
    it("should return null when title is missing", () => {
      const offer = {
        title: "",
        description: "We need TypeScript experience.",
      };

      const fp = computeOfferFingerprint(offer);
      expect(fp).toBeNull();
    });

    it("should return null when description is missing", () => {
      const offer = {
        title: "Senior Developer",
        description: "",
      };

      const fp = computeOfferFingerprint(offer);
      expect(fp).toBeNull();
    });

    it("should return null when both title and description are missing", () => {
      const offer = {
        title: null,
        description: null,
      };

      const fp = computeOfferFingerprint(offer);
      expect(fp).toBeNull();
    });

    it("should return null when title normalizes to empty (e.g., only punctuation)", () => {
      const offer = {
        title: "...!!!",
        description: "We need TypeScript experience.",
      };

      const fp = computeOfferFingerprint(offer);
      expect(fp).toBeNull();
    });

    it("should return null when description normalizes to empty", () => {
      const offer = {
        title: "Senior Developer",
        description: "...",
      };

      const fp = computeOfferFingerprint(offer);
      expect(fp).toBeNull();
    });
  });

  describe("format", () => {
    it("should return a 64-character hex string (SHA-256)", () => {
      const offer = {
        title: "Senior Developer",
        description: "We need TypeScript experience.",
      };

      const fp = computeOfferFingerprint(offer);

      expect(fp).not.toBeNull();
      expect(fp).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("edge cases", () => {
    it("should handle special characters and technical terms", () => {
      const offer1 = {
        title: "Full-Stack Developer (C++/Python)",
        description: "Need experience with C++, Python, and Node.js.",
      };

      const offer2 = {
        title: "Full Stack Developer (C++ / Python)",
        description: "Need experience with C++, Python, and Node.js.",
      };

      const fp1 = computeOfferFingerprint(offer1);
      const fp2 = computeOfferFingerprint(offer2);

      // Should be identical due to normalization
      expect(fp1).toBe(fp2);
    });

    it("should handle very long descriptions", () => {
      const longDescription = "a".repeat(10000);
      const offer = {
        title: "Senior Developer",
        description: longDescription,
      };

      const fp = computeOfferFingerprint(offer);

      expect(fp).not.toBeNull();
      expect(fp).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should handle unicode and emoji", () => {
      const offer = {
        title: "Desarrollador 🚀",
        description: "¡Únete a nuestro equipo! 💻",
      };

      const fp = computeOfferFingerprint(offer);

      expect(fp).not.toBeNull();
      expect(fp).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
