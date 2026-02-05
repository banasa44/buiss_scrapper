/**
 * Unit tests for text normalization and tokenization
 *
 * Tests pure, deterministic tokenization logic used by matcher/scorer
 * No DB, no network, no side effects
 */

import { describe, it, expect } from "vitest";
import { normalizeToTokens } from "@/utils/text/textNormalization";

describe("normalizeToTokens", () => {
  describe("basic normalization", () => {
    it("should return empty array for empty string", () => {
      expect(normalizeToTokens("")).toEqual([]);
    });

    it("should return empty array for whitespace-only input", () => {
      expect(normalizeToTokens("   ")).toEqual([]);
      expect(normalizeToTokens("\t\n\r")).toEqual([]);
      expect(normalizeToTokens("  \t  \n  ")).toEqual([]);
    });

    it("should lowercase and tokenize simple text", () => {
      expect(normalizeToTokens("Hello World")).toEqual(["hello", "world"]);
      expect(normalizeToTokens("BACKEND DEVELOPER")).toEqual([
        "backend",
        "developer",
      ]);
    });

    it("should handle multiple whitespace between words", () => {
      expect(normalizeToTokens("hello    world")).toEqual(["hello", "world"]);
      expect(normalizeToTokens("test  \t  tokens")).toEqual(["test", "tokens"]);
    });
  });

  describe("diacritic removal", () => {
    it("should remove accents and diacritics", () => {
      expect(normalizeToTokens("café")).toEqual(["cafe"]);
      expect(normalizeToTokens("José niño")).toEqual(["jose", "nino"]);
      expect(normalizeToTokens("Société Générale")).toEqual([
        "societe",
        "generale",
      ]);
      expect(normalizeToTokens("Zürich España")).toEqual(["zurich", "espana"]);
    });
  });

  describe("separator splitting", () => {
    it("should split on forward slash", () => {
      expect(normalizeToTokens("AWS/GCP/Azure")).toEqual([
        "aws",
        "gcp",
        "azure",
      ]);
      expect(normalizeToTokens("C++/Python/Java")).toEqual([
        "c++",
        "python",
        "java",
      ]);
    });

    it("should split on hyphen", () => {
      expect(normalizeToTokens("Full-Stack")).toEqual(["full", "stack"]);
      expect(normalizeToTokens("Front-End-Developer")).toEqual([
        "front",
        "end",
        "developer",
      ]);
    });

    it("should split on underscore", () => {
      expect(normalizeToTokens("snake_case_variable")).toEqual([
        "snake",
        "case",
        "variable",
      ]);
    });

    it("should split on parentheses", () => {
      expect(normalizeToTokens("Developer (Remote)")).toEqual([
        "developer",
        "remote",
      ]);
      expect(normalizeToTokens("(Junior) Developer")).toEqual([
        "junior",
        "developer",
      ]);
    });

    it("should split on brackets", () => {
      expect(normalizeToTokens("Developer [Full-Time]")).toEqual([
        "developer",
        "full",
        "time",
      ]);
      expect(normalizeToTokens("Tech{Stack}Jobs")).toEqual([
        "tech",
        "stack",
        "jobs",
      ]);
    });

    it("should split on comma and semicolon", () => {
      expect(normalizeToTokens("Python, Java, Go")).toEqual([
        "python",
        "java",
        "go",
      ]);
      expect(normalizeToTokens("backend; frontend; devops")).toEqual([
        "backend",
        "frontend",
        "devops",
      ]);
    });

    it("should split on period, colon, exclamation, and question mark", () => {
      expect(normalizeToTokens("hello.world")).toEqual(["hello", "world"]);
      expect(normalizeToTokens("title: Developer")).toEqual([
        "title",
        "developer",
      ]);
      expect(normalizeToTokens("Urgent! Apply now")).toEqual([
        "urgent",
        "apply",
        "now",
      ]);
      expect(normalizeToTokens("Questions? Contact us")).toEqual([
        "questions",
        "contact",
        "us",
      ]);
    });

    it("should split on quotes and pipe", () => {
      expect(normalizeToTokens('"Full Stack" Developer')).toEqual([
        "full",
        "stack",
        "developer",
      ]);
      expect(normalizeToTokens("Python | Java | Go")).toEqual([
        "python",
        "java",
        "go",
      ]);
    });

    it("should split on backslash", () => {
      expect(normalizeToTokens("path\\to\\file")).toEqual([
        "path",
        "to",
        "file",
      ]);
    });
  });

  describe("technical tokens and edge cases", () => {
    it("should preserve C++ as a single token (no separators within)", () => {
      // C++ has no separator characters between C and ++, so it stays together
      expect(normalizeToTokens("C++")).toEqual(["c++"]);
      expect(normalizeToTokens("C++ Developer")).toEqual(["c++", "developer"]);
    });

    it("should split complex technical expressions", () => {
      expect(normalizeToTokens("Full-Stack Developer (C++/Python)")).toEqual([
        "full",
        "stack",
        "developer",
        "c++",
        "python",
      ]);
    });

    it("should handle consecutive separators", () => {
      // Multiple separators in a row should not produce empty tokens
      expect(normalizeToTokens("hello---world")).toEqual(["hello", "world"]);
      expect(normalizeToTokens("test/.//.//file")).toEqual(["test", "file"]);
    });

    it("should handle separators at start and end", () => {
      expect(normalizeToTokens("--hello--")).toEqual(["hello"]);
      expect(normalizeToTokens("/start/end/")).toEqual(["start", "end"]);
    });
  });

  describe("negation token preservation", () => {
    it("should preserve Spanish negation tokens", () => {
      // "sin" (without) must be preserved as a token for negation handling
      expect(normalizeToTokens("sin experiencia")).toEqual([
        "sin",
        "experiencia",
      ]);
      expect(normalizeToTokens("Desarrollador sin experiencia")).toEqual([
        "desarrollador",
        "sin",
        "experiencia",
      ]);
    });

    it("should preserve English negation tokens", () => {
      expect(normalizeToTokens("no experience required")).toEqual([
        "no",
        "experience",
        "required",
      ]);
      expect(normalizeToTokens("not required")).toEqual(["not", "required"]);
      expect(normalizeToTokens("without experience")).toEqual([
        "without",
        "experience",
      ]);
    });
  });

  describe("stress and edge cases", () => {
    it("should handle long text without crashing", () => {
      // Generate a long string with many tokens
      const longText = Array(1000).fill("developer").join(" ");
      const tokens = normalizeToTokens(longText);

      // Should return an array with 1000 tokens
      expect(Array.isArray(tokens)).toBe(true);
      expect(tokens.length).toBe(1000);
      expect(tokens[0]).toBe("developer");
    });

    it("should handle text with mixed separators", () => {
      expect(
        normalizeToTokens("Full-Stack/Backend Developer (Python, Java)"),
      ).toEqual(["full", "stack", "backend", "developer", "python", "java"]);
    });

    it("should handle newlines and tabs", () => {
      expect(normalizeToTokens("line1\nline2\tline3")).toEqual([
        "line1",
        "line2",
        "line3",
      ]);
    });
  });
});
