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

    it("should handle mixed punctuation and spacing", () => {
      expect(normalizeToTokens("  Full-Stack,  Dev (C++/Python)  ")).toEqual([
        "full",
        "stack",
        "dev",
        "c++",
        "python",
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

  describe("Matcher Hardening - Increment 1: Currency symbol injection", () => {
    it("should inject 'usd' token when $ symbol is present", () => {
      const result = normalizeToTokens("Salary $100K");
      expect(result).toContain("$100k");
      expect(result).toContain("usd");
      expect(result).toEqual(["salary", "$100k", "usd"]);
    });

    it("should inject 'gbp' token when £ symbol is present", () => {
      const result = normalizeToTokens("Salary £50K");
      expect(result).toContain("£50k");
      expect(result).toContain("gbp");
      expect(result).toEqual(["salary", "£50k", "gbp"]);
    });

    it("should inject 'eur' token when € symbol is present", () => {
      const result = normalizeToTokens("Salary €60K");
      expect(result).toContain("€60k");
      expect(result).toContain("eur");
      expect(result).toEqual(["salary", "€60k", "eur"]);
    });

    it("should handle multiple currency symbols in different tokens", () => {
      const result = normalizeToTokens("$100K or €80K");
      expect(result).toContain("$100k");
      expect(result).toContain("€80k");
      expect(result).toContain("usd");
      expect(result).toContain("eur");
    });

    it("should inject currency token even for standalone symbols", () => {
      const result = normalizeToTokens("paid in $");
      expect(result).toContain("$");
      expect(result).toContain("usd");
    });

    it("should handle USD keyword alongside $ symbol", () => {
      // Both the token containing $ and the explicit "usd" keyword trigger injection
      const result = normalizeToTokens("$100K USD");
      expect(result).toContain("$100k");
      expect(result).toContain("usd");
      // Note: "usd" appears twice - once from explicit mention, once from $ injection
      expect(result.filter((t) => t === "usd").length).toBe(2);
    });
  });

  describe("Matcher Hardening - Increment 1: Unicode punctuation", () => {
    it("should split on curly double quotes", () => {
      expect(normalizeToTokens("\u201cUSD\u201d")).toEqual(["usd"]);
      expect(normalizeToTokens("\u201cGBP\u201d currency")).toEqual([
        "gbp",
        "currency",
      ]);
    });

    it("should split on curly single quotes", () => {
      expect(normalizeToTokens("\u2018EUR\u2019")).toEqual(["eur"]);
      expect(normalizeToTokens("\u2018GBP\u2019 required")).toEqual([
        "gbp",
        "required",
      ]);
    });

    it("should handle mixed ASCII and Unicode quotes", () => {
      expect(normalizeToTokens('"USD" or \u201cEUR\u201d')).toEqual([
        "usd",
        "or",
        "eur",
      ]);
    });
  });

  describe("Matcher Hardening - Regression: existing behavior preserved", () => {
    it("should still match existing non-currency keywords", () => {
      // Ensure we didn't break existing tokenization
      expect(normalizeToTokens("AWS GCP Azure")).toEqual([
        "aws",
        "gcp",
        "azure",
      ]);
      expect(normalizeToTokens("Stripe Salesforce")).toEqual([
        "stripe",
        "salesforce",
      ]);
    });

    it("should still split on commas and periods", () => {
      expect(normalizeToTokens("USD, GBP, EUR.")).toEqual([
        "usd",
        "gbp",
        "eur",
      ]);
    });

    it("should still handle parentheses", () => {
      expect(normalizeToTokens("(GBP) accepted")).toEqual(["gbp", "accepted"]);
    });
  });

  describe("Matcher Hardening - Increment 2: US/UK/LATAM variant injection", () => {
    it("should inject 'us' and 'usa' tokens for consecutive ['u','s'] pattern", () => {
      const result = normalizeToTokens("U.S. market");
      expect(result).toContain("u");
      expect(result).toContain("s");
      expect(result).toContain("us");
      expect(result).toContain("usa");
      expect(result).toContain("market");
    });

    it("should inject 'uk' token for consecutive ['u','k'] pattern", () => {
      const result = normalizeToTokens("U.K. expansion");
      expect(result).toContain("u");
      expect(result).toContain("k");
      expect(result).toContain("uk");
      expect(result).toContain("expansion");
    });

    it("should inject 'us' and 'usa' tokens for Spanish EEUU", () => {
      const result = normalizeToTokens("EEUU market");
      expect(result).toContain("eeuu");
      expect(result).toContain("us");
      expect(result).toContain("usa");
      expect(result).toContain("market");
    });

    it("should inject 'latam' token for latinoamerica variant", () => {
      const result = normalizeToTokens("latinoamerica expansion");
      expect(result).toContain("latinoamerica");
      expect(result).toContain("latam");
      expect(result).toContain("expansion");
    });

    it("should handle 'latam' token idempotently", () => {
      const result = normalizeToTokens("LATAM region");
      expect(result).toContain("latam");
      expect(result).toEqual(["latam", "region"]);
    });

    it("should handle multiple region abbreviations in same text", () => {
      const result = normalizeToTokens("U.S. and U.K. markets");
      expect(result).toContain("us");
      expect(result).toContain("usa");
      expect(result).toContain("uk");
    });

    it("should handle EEUU with other keywords", () => {
      const result = normalizeToTokens("EEUU USD salary");
      expect(result).toContain("eeuu");
      expect(result).toContain("us");
      expect(result).toContain("usa");
      expect(result).toContain("usd");
      expect(result).toContain("salary");
    });
  });

  describe("Matcher Hardening - Regression: Increment 2 non-interference", () => {
    it("should not affect unrelated text with 'u' or 's' tokens separately", () => {
      // "u" alone without following "s" should not inject anything
      const result1 = normalizeToTokens("uber driver");
      expect(result1).not.toContain("us");
      expect(result1).not.toContain("usa");

      // "s" alone should not inject anything
      const result2 = normalizeToTokens("senior developer");
      expect(result2).not.toContain("us");
      expect(result2).not.toContain("usa");
    });

    it("should not affect 'us' appearing as part of longer words", () => {
      // "us" should only be injected for consecutive ["u","s"], not from substring
      const result = normalizeToTokens("business");
      expect(result).toEqual(["business"]);
    });

    it("should preserve existing tokenization for non-region keywords", () => {
      const result = normalizeToTokens("AWS GCP kubernetes");
      expect(result).toEqual(["aws", "gcp", "kubernetes"]);
    });
  });
});
