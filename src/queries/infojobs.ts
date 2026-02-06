/**
 * InfoJobs query registry
 *
 * Defines the set of registered queries for InfoJobs provider.
 * These queries represent example searches for Spain, designed to be broad.
 *
 * NOTE: These are examples and may not work without proper auth configuration.
 */

import type { RegisteredQuery } from "@/types";
import { generateQueryKey } from "./queryKey";
import {
  INFOJOBS_DEFAULT_MAX_PAGES,
  INFOJOBS_DEFAULT_MAX_OFFERS,
} from "@/constants";

/**
 * InfoJobs registered queries
 *
 * Example queries designed to be broad for Spain:
 * - es_generic_tech: Generic tech search (broad, many results expected)
 * - es_generic_all: Very broad search (no text filter)
 */
export const INFOJOBS_QUERIES: RegisteredQuery[] = [
  {
    client: "infojobs",
    name: "es_generic_tech",
    params: {
      text: "developer",
      maxPages: INFOJOBS_DEFAULT_MAX_PAGES,
      maxOffers: INFOJOBS_DEFAULT_MAX_OFFERS,
    },
    queryKey: "", // Will be computed below
  },
  {
    client: "infojobs",
    name: "es_generic_all",
    params: {
      maxPages: INFOJOBS_DEFAULT_MAX_PAGES,
      maxOffers: INFOJOBS_DEFAULT_MAX_OFFERS,
    },
    queryKey: "", // Will be computed below
  },
];

// Compute query keys for all queries
for (const query of INFOJOBS_QUERIES) {
  query.queryKey = generateQueryKey(query.client, query.name, query.params);
}
