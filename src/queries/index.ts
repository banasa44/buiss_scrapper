/**
 * Query registry — single source of truth for registered queries
 *
 * Exports all registered queries and provides validation.
 * Future orchestrator/scheduler will iterate over ALL_QUERIES.
 */

import type { RegisteredQuery } from "@/types";
import { INFOJOBS_QUERIES } from "./infojobs";

/**
 * All registered queries across all providers
 */
export const ALL_QUERIES: RegisteredQuery[] = [...INFOJOBS_QUERIES];

/**
 * Validate query registry at load time
 *
 * Ensures:
 * - Query names are unique within each client
 * - Query keys are globally unique
 * - Required fields are present and valid
 *
 * @throws Error if validation fails
 */
export function validateRegistry(): void {
  if (ALL_QUERIES.length === 0) {
    throw new Error(
      "Query registry is empty - at least one query must be defined",
    );
  }

  // Track names per client
  const namesByClient = new Map<string, Set<string>>();

  // Track all query keys
  const seenKeys = new Set<string>();

  for (const query of ALL_QUERIES) {
    // Check required fields
    if (!query.client) {
      throw new Error("Query missing required field: client");
    }
    if (!query.name) {
      throw new Error(`Query for client '${query.client}' missing name`);
    }
    if (!query.params) {
      throw new Error(
        `Query '${query.client}:${query.name}' missing params field`,
      );
    }
    if (!query.queryKey) {
      throw new Error(`Query '${query.client}:${query.name}' missing queryKey`);
    }

    // Check name uniqueness within client
    if (!namesByClient.has(query.client)) {
      namesByClient.set(query.client, new Set());
    }
    const clientNames = namesByClient.get(query.client)!;
    if (clientNames.has(query.name)) {
      throw new Error(
        `Duplicate query name '${query.name}' for client '${query.client}'`,
      );
    }
    clientNames.add(query.name);

    // Check queryKey uniqueness
    if (seenKeys.has(query.queryKey)) {
      throw new Error(
        `Duplicate queryKey '${query.queryKey}' for query '${query.client}:${query.name}'`,
      );
    }
    seenKeys.add(query.queryKey);
  }
}

// Run validation at module load time
validateRegistry();
