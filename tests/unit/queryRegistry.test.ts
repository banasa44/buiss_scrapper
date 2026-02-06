/**
 * Unit tests for query registry and query key generation
 *
 * Tests deterministic key generation, normalization, and registry validation.
 * No DB, no network, no side effects.
 */

import { describe, it, expect } from "vitest";
import { generateQueryKey } from "@/queries/queryKey";
import { ALL_QUERIES, validateRegistry } from "@/queries";
import type { SearchOffersQuery } from "@/types";

describe("generateQueryKey", () => {
  describe("deterministic key generation", () => {
    it("should generate the same key for identical params", () => {
      const params: SearchOffersQuery = {
        text: "developer",
        maxPages: 10,
        maxOffers: 500,
      };

      const key1 = generateQueryKey("infojobs", "test_query", params);
      const key2 = generateQueryKey("infojobs", "test_query", params);

      expect(key1).toBe(key2);
    });

    it("should generate different keys for different params", () => {
      const params1: SearchOffersQuery = {
        text: "developer",
        maxPages: 10,
      };

      const params2: SearchOffersQuery = {
        text: "engineer",
        maxPages: 10,
      };

      const key1 = generateQueryKey("infojobs", "query1", params1);
      const key2 = generateQueryKey("infojobs", "query1", params2);

      expect(key1).not.toBe(key2);
    });

    it("should generate different keys for different names", () => {
      const params: SearchOffersQuery = {
        text: "developer",
      };

      const key1 = generateQueryKey("infojobs", "name1", params);
      const key2 = generateQueryKey("infojobs", "name2", params);

      expect(key1).not.toBe(key2);
    });

    it("should generate different keys for different clients", () => {
      const params: SearchOffersQuery = {
        text: "developer",
      };

      const key1 = generateQueryKey("infojobs", "query", params);
      const key2 = generateQueryKey("linkedin", "query", params);

      expect(key1).not.toBe(key2);
    });
  });

  describe("key format", () => {
    it("should follow the format client:name:hash", () => {
      const params: SearchOffersQuery = {
        text: "developer",
      };

      const key = generateQueryKey("infojobs", "es_tech", params);
      const parts = key.split(":");

      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("infojobs");
      expect(parts[1]).toBe("es_tech");
      expect(parts[2]).toHaveLength(12); // QUERY_KEY_HASH_LENGTH
    });

    it("should generate hex hash component", () => {
      const params: SearchOffersQuery = {
        text: "developer",
      };

      const key = generateQueryKey("infojobs", "test", params);
      const hash = key.split(":")[2];

      // Should be valid hex (0-9, a-f)
      expect(/^[0-9a-f]{12}$/.test(hash)).toBe(true);
    });
  });

  describe("normalization", () => {
    it("should treat undefined fields the same as missing fields", () => {
      const params1: SearchOffersQuery = {
        text: "developer",
      };

      const params2: SearchOffersQuery = {
        text: "developer",
        updatedSince: undefined,
      };

      const key1 = generateQueryKey("infojobs", "query", params1);
      const key2 = generateQueryKey("infojobs", "query", params2);

      expect(key1).toBe(key2);
    });

    it("should be insensitive to key order in params", () => {
      // Note: TypeScript object property order doesn't matter for JSON.stringify
      // after we sort keys, but this test verifies normalization works
      const params1: SearchOffersQuery = {
        text: "developer",
        maxPages: 10,
        maxOffers: 500,
      };

      const params2: SearchOffersQuery = {
        maxOffers: 500,
        text: "developer",
        maxPages: 10,
      };

      const key1 = generateQueryKey("infojobs", "query", params1);
      const key2 = generateQueryKey("infojobs", "query", params2);

      expect(key1).toBe(key2);
    });

    it("should generate different hashes for different maxPages", () => {
      const params1: SearchOffersQuery = {
        text: "developer",
        maxPages: 10,
      };

      const params2: SearchOffersQuery = {
        text: "developer",
        maxPages: 20,
      };

      const key1 = generateQueryKey("infojobs", "query", params1);
      const key2 = generateQueryKey("infojobs", "query", params2);

      expect(key1).not.toBe(key2);
    });
  });
});

describe("query registry", () => {
  describe("ALL_QUERIES", () => {
    it("should contain at least one query", () => {
      expect(ALL_QUERIES.length).toBeGreaterThan(0);
    });

    it("should have valid query structure", () => {
      for (const query of ALL_QUERIES) {
        expect(query).toHaveProperty("client");
        expect(query).toHaveProperty("name");
        expect(query).toHaveProperty("params");
        expect(query).toHaveProperty("queryKey");

        expect(typeof query.client).toBe("string");
        expect(typeof query.name).toBe("string");
        expect(typeof query.params).toBe("object");
        expect(typeof query.queryKey).toBe("string");
      }
    });

    it("should have unique query keys", () => {
      const keys = ALL_QUERIES.map((q) => q.queryKey);
      const uniqueKeys = new Set(keys);

      expect(uniqueKeys.size).toBe(keys.length);
    });

    it("should have unique names per client", () => {
      const namesByClient = new Map<string, Set<string>>();

      for (const query of ALL_QUERIES) {
        if (!namesByClient.has(query.client)) {
          namesByClient.set(query.client, new Set());
        }

        const clientNames = namesByClient.get(query.client)!;
        expect(clientNames.has(query.name)).toBe(false);
        clientNames.add(query.name);
      }
    });

    it("should have properly formatted query keys", () => {
      for (const query of ALL_QUERIES) {
        const parts = query.queryKey.split(":");

        expect(parts).toHaveLength(3);
        expect(parts[0]).toBe(query.client);
        expect(parts[1]).toBe(query.name);
        expect(parts[2]).toHaveLength(12);
        expect(/^[0-9a-f]{12}$/.test(parts[2])).toBe(true);
      }
    });
  });

  describe("validateRegistry", () => {
    it("should not throw for valid registry", () => {
      // Registry is already validated at module load time
      // This test just verifies it can be called without errors
      expect(() => validateRegistry()).not.toThrow();
    });
  });
});
