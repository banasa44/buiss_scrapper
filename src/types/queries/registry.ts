/**
 * Query registry type definitions
 *
 * These types define the structure of registered queries that serve as the
 * source of truth for what queries exist to run.
 */

import type { Provider, SearchOffersQuery } from "../clients/job_offers";

/**
 * A registered query in the query registry
 *
 * Represents a single configured query that can be scheduled and executed.
 * The queryKey is derived deterministically from client, name, and normalized params.
 */
export type RegisteredQuery = {
  /** Provider/client identifier (e.g., "infojobs") */
  client: Provider;

  /** Stable human-readable name for the query (e.g., "es_generic_all") */
  name: string;

  /** Search parameters for the query */
  params: SearchOffersQuery;

  /** Derived unique identifier: <client>:<name>:<hash(params)> */
  queryKey: string;
};
