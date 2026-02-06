/**
 * Query key derivation — deterministic hash-based identifiers
 *
 * Generates unique, stable query keys from client + name + params.
 * Format: <client>:<name>:<hash(normalizedParams)>
 *
 * Keys are stable across runs if params remain the same.
 * Normalization ensures deterministic hashing (sorted keys, undefined handling).
 */

import { createHash } from "crypto";
import type { Provider, SearchOffersQuery } from "@/types";
import { QUERY_KEY_HASH_LENGTH } from "@/constants";

/**
 * Normalize query params for deterministic hashing
 *
 * - Sorts object keys alphabetically
 * - Removes undefined values (treat as missing)
 * - Returns JSON string for hashing
 *
 * @param params - Query parameters to normalize
 * @returns Normalized JSON string
 */
function normalizeParams(params: SearchOffersQuery): string {
  // Remove undefined values
  const cleaned: Partial<SearchOffersQuery> = {};
  for (const key of Object.keys(params) as Array<keyof SearchOffersQuery>) {
    if (params[key] !== undefined) {
      cleaned[key] = params[key] as any;
    }
  }

  // Sort keys and stringify
  const sorted = Object.keys(cleaned)
    .sort()
    .reduce(
      (acc, key) => {
        acc[key] = cleaned[key as keyof typeof cleaned];
        return acc;
      },
      {} as Record<string, any>,
    );

  return JSON.stringify(sorted);
}

/**
 * Generate a deterministic query key
 *
 * Format: <client>:<name>:<hash>
 * Hash is SHA-256 of normalized params, truncated to QUERY_KEY_HASH_LENGTH
 *
 * @param client - Provider/client identifier
 * @param name - Stable human-readable query name
 * @param params - Query parameters
 * @returns Deterministic query key
 */
export function generateQueryKey(
  client: Provider,
  name: string,
  params: SearchOffersQuery,
): string {
  const normalized = normalizeParams(params);
  const hash = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .substring(0, QUERY_KEY_HASH_LENGTH);

  return `${client}:${name}:${hash}`;
}
