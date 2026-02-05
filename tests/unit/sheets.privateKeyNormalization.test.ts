/**
 * Unit tests for Google Service Account private key normalization
 *
 * Tests robust parsing of GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env values:
 * - Quoted strings
 * - Literal \n escapes
 * - Extra whitespace
 * - PEM marker validation
 *
 * No DB, no network, no Google API calls
 */

import { describe, it, expect } from "vitest";
import { normalizePrivateKey } from "@/utils/sheets/sheetsHelpers";

const VALID_KEY_BASE = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDYvqiQzuuNtYrC
TrrfBErI5EKxL27PeiRD5puas34nLxCg0/O23WY486L4YINF8xQZrS2swVa6ali8
0DKpPUCLJekNEAbTgG7A9eafRF85no4yrjZNBQ4TOUNikcOTc6xokilptmzDwhmH
-----END PRIVATE KEY-----`;

describe("normalizePrivateKey", () => {
  describe("successful normalization", () => {
    it("handles unquoted key with real newlines", () => {
      const result = normalizePrivateKey(VALID_KEY_BASE, "test_source");
      expect(result).toBe(VALID_KEY_BASE);
      expect(result).toContain("-----BEGIN PRIVATE KEY-----");
      expect(result).toContain("-----END PRIVATE KEY-----");
    });

    it("handles double-quoted key with \\n escapes", () => {
      const input = `"-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDYvqiQzuuNtYrC\\nTrrfBErI5EKxL27PeiRD5puas34nLxCg0/O23WY486L4YINF8xQZrS2swVa6ali8\\n0DKpPUCLJekNEAbTgG7A9eafRF85no4yrjZNBQ4TOUNikcOTc6xokilptmzDwhmH\\n-----END PRIVATE KEY-----\\n"`;
      const result = normalizePrivateKey(input, "test_source");
      expect(result).toContain("-----BEGIN PRIVATE KEY-----");
      expect(result).toContain("-----END PRIVATE KEY-----");
      expect(result).toContain("\n"); // Actual newlines
      expect(result).not.toContain("\\n"); // No literal escapes
    });

    it("handles single-quoted key with \\n escapes", () => {
      const input = `'-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDYvqiQzuuNtYrC\\n-----END PRIVATE KEY-----\\n'`;
      const result = normalizePrivateKey(input, "test_source");
      expect(result).toContain("-----BEGIN PRIVATE KEY-----");
      expect(result).toContain("-----END PRIVATE KEY-----");
      expect(result).toContain("\n");
    });

    it("strips extra whitespace around the key", () => {
      const input = `  \n  ${VALID_KEY_BASE}  \n  `;
      const result = normalizePrivateKey(input, "test_source");
      expect(result).toBe(VALID_KEY_BASE);
    });

    it("handles \\r\\n line endings (Windows style)", () => {
      const input = `"-----BEGIN PRIVATE KEY-----\\r\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDYvqiQzuuNtYrC\\r\\n-----END PRIVATE KEY-----\\r\\n"`;
      const result = normalizePrivateKey(input, "test_source");
      expect(result).toContain("-----BEGIN PRIVATE KEY-----");
      expect(result).not.toContain("\r"); // \r\n normalized to \n
    });

    it("handles quoted key with extra whitespace", () => {
      const input = `  "-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDYvqiQzuuNtYrC\\n-----END PRIVATE KEY-----\\n"  `;
      const result = normalizePrivateKey(input, "test_source");
      expect(result).toContain("-----BEGIN PRIVATE KEY-----");
      expect(result).toContain("-----END PRIVATE KEY-----");
    });
  });

  describe("validation errors", () => {
    it("throws on undefined key", () => {
      expect(() => normalizePrivateKey(undefined, "TEST_VAR")).toThrow(
        /TEST_VAR is missing or empty/,
      );
    });

    it("throws on empty string", () => {
      expect(() => normalizePrivateKey("", "TEST_VAR")).toThrow(
        /TEST_VAR is missing or empty/,
      );
    });

    it("throws on whitespace-only string", () => {
      expect(() => normalizePrivateKey("   \n  ", "TEST_VAR")).toThrow(
        /TEST_VAR is empty after normalization/,
      );
    });

    it("throws on empty quoted string", () => {
      expect(() => normalizePrivateKey('""', "TEST_VAR")).toThrow(
        /TEST_VAR is empty after normalization/,
      );
    });

    it("throws on missing BEGIN marker", () => {
      const invalidKey = `-----INVALID START-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDYvqiQzuuNtYrC\\n-----END PRIVATE KEY-----\\n`;
      expect(() => normalizePrivateKey(invalidKey, "TEST_VAR")).toThrow(
        /TEST_VAR does not contain valid PEM markers/,
      );
    });

    it("throws on missing END marker", () => {
      const invalidKey = `-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDYvqiQzuuNtYrC\\n-----INVALID END-----\\n`;
      expect(() => normalizePrivateKey(invalidKey, "TEST_VAR")).toThrow(
        /TEST_VAR does not contain valid PEM markers/,
      );
    });

    it("throws on completely invalid content", () => {
      expect(() => normalizePrivateKey("not-a-key", "TEST_VAR")).toThrow(
        /TEST_VAR does not contain valid PEM markers/,
      );
    });

    it("error message includes expected format hint", () => {
      expect(() => normalizePrivateKey(undefined, "TEST_VAR")).toThrow(
        /Expected format.*BEGIN PRIVATE KEY/,
      );
    });

    it("error message never leaks key content", () => {
      const secretKey = `"-----BEGIN PRIVATE KEY-----\\nsecret123\\n-----END PRIVATE KEY-----\\n"`;
      try {
        // This will fail validation (too short), but shouldn't leak "secret123"
        normalizePrivateKey("secret-data", "TEST_VAR");
      } catch (err) {
        expect((err as Error).message).not.toContain("secret");
        expect((err as Error).message).toContain("TEST_VAR");
      }
    });
  });

  describe("realistic .env scenarios", () => {
    it("handles typical .env format from Google Cloud Console", () => {
      // This is how the key typically appears after copy-paste from GCP
      const envValue = `"-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDYvqiQzuuNtYrC\\nTrrfBErI5EKxL27PeiRD5puas34nLxCg0/O23WY486L4YINF8xQZrS2swVa6ali8\\n0DKpPUCLJekNEAbTgG7A9eafRF85no4yrjZNBQ4TOUNikcOTc6xokilptmzDwhmH\\nnJ4zkWEx58dhF1s8kfBA0ivZVMFdcOlZb1jyBJF3sfzewCaimJ5TTLjrmAWjaZBZ\\n-----END PRIVATE KEY-----\\n"`;

      const result = normalizePrivateKey(
        envValue,
        "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
      );

      // Should have actual newlines
      const lines = result.split("\n");
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]).toBe("-----BEGIN PRIVATE KEY-----");
      expect(lines[lines.length - 1]).toBe("-----END PRIVATE KEY-----");

      // Should not have literal \n
      expect(result).not.toContain("\\n");
    });

    it("handles multiline paste without quotes (less common)", () => {
      const result = normalizePrivateKey(
        VALID_KEY_BASE,
        "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
      );
      expect(result).toBe(VALID_KEY_BASE);
    });

    it("handles accidentally pasted quotes within the value", () => {
      // Edge case: someone pastes the JSON value directly including quotes
      const jsonStyleInput = `"\\"-----BEGIN PRIVATE KEY-----\\\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDYvqiQzuuNtYrC\\\\n-----END PRIVATE KEY-----\\\\n\\""`;

      // This would be double-escaped. After first unquote, we still have escaped content.
      // Our current implementation strips outer quotes and then converts all \n to newlines,
      // which means \\n becomes \n (the escaped version becomes real newlines).
      // This is actually the desired behavior for the common case.
      const result = normalizePrivateKey(jsonStyleInput, "TEST");

      // After stripping outer quotes and converting escapes, we get actual newlines
      expect(result).toContain("\n");
      expect(result).toContain("-----BEGIN PRIVATE KEY-----");
      expect(result).toContain("-----END PRIVATE KEY-----");
    });
  });
});
