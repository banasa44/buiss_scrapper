/**
 * Run lifecycle helpers — track ingestion runs in the database
 *
 * One run = one end-to-end execution for a single provider.
 * These helpers ensure every run is finalized (success or failure).
 */

import type {
  Provider,
  SearchOffersQuery,
  RunCounters,
  RunStatus,
  RunAccumulator,
} from "@/types";
import { createRun, finishRun as repoFinishRun } from "@/db";

/**
 * Start a new ingestion run for a provider
 *
 * @param provider - The provider identifier (e.g., "infojobs")
 * @param _query - Search query (unused for now; query_fingerprint = NULL)
 * @returns The run ID
 */
export function startRun(
  provider: Provider,
  _query?: SearchOffersQuery,
): number {
  // query_fingerprint is NULL for now (future: hash the query for deduplication)
  return createRun({
    provider,
    query_fingerprint: null,
  });
}

/**
 * Finish an ingestion run with status and optional counters
 *
 * @param runId - The run ID to finalize
 * @param status - "success" or "failure"
 * @param patch - Optional counters to update (pages_fetched, offers_fetched, errors_count)
 */
export function finishRun(
  runId: number,
  status: RunStatus,
  patch?: Partial<RunCounters>,
): void {
  repoFinishRun(runId, {
    finished_at: new Date().toISOString(),
    status,
    ...(patch?.pages_fetched !== undefined && {
      pages_fetched: patch.pages_fetched,
    }),
    ...(patch?.offers_fetched !== undefined && {
      offers_fetched: patch.offers_fetched,
    }),
    ...(patch?.errors_count !== undefined && {
      errors_count: patch.errors_count,
    }),
  });
}

/**
 * Create a fresh run accumulator for tracking counters during execution
 *
 * @returns A mutable accumulator with zeroed counters
 */
export function createRunAccumulator(): RunAccumulator {
  return {
    counters: {
      pages_fetched: 0,
      offers_fetched: 0,
      errors_count: 0,
    },
  };
}

/**
 * Execute a function within a run lifecycle
 *
 * Guarantees the run is finalized regardless of success or failure.
 * On success: status = "success"
 * On error: status = "failure", then rethrows the error
 *
 * **Counter management:**
 * - The `fn` callback receives a mutable `RunAccumulator` object.
 * - Callers should increment `acc.counters.pages_fetched`, `acc.counters.offers_fetched`,
 *   and `acc.counters.errors_count` during execution.
 * - Counters are persisted in the `finally` block, ensuring they are saved even if `fn` throws.
 *
 * **Counter semantics:**
 * - `pages_fetched`: Number of API pages successfully retrieved.
 * - `offers_fetched`: Number of offers attempted for ingestion (not necessarily successfully upserted).
 * - `errors_count`: Count of fatal errors only (DB unavailable, auth failure, etc.);
 *   per-record skips do not increment this counter.
 *
 * @param provider - The provider identifier
 * @param query - Optional search query
 * @param fn - Async function to execute, receives (runId, acc) where acc is a mutable accumulator
 * @returns The result of fn
 */
export async function withRun<T>(
  provider: Provider,
  query: SearchOffersQuery | undefined,
  fn: (runId: number, acc: RunAccumulator) => Promise<T>,
): Promise<T> {
  const runId = startRun(provider, query);
  const acc = createRunAccumulator();
  let succeeded = false;

  try {
    const result = await fn(runId, acc);
    succeeded = true;
    return result;
  } finally {
    // Always finalize the run with accumulated counters
    finishRun(runId, succeeded ? "success" : "failure", acc.counters);
  }
}
