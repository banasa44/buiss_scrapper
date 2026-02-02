/**
 * Batch company aggregation orchestrator (M4.B3.3)
 *
 * Processes multiple company aggregations with:
 * - Chunked execution (avoid long blocking operations)
 * - Per-company retries (transient failures)
 * - Graceful error handling (log and continue)
 *
 * Called at end-of-run after all offers+matches are persisted.
 */

import { aggregateCompanyAndPersist } from "@/signal/aggregation";
import * as logger from "@/logger";

/**
 * Configuration for batch aggregation
 */
const CHUNK_SIZE = 50; // Process companies in batches of 50
const MAX_RETRIES = 2; // Retry up to 2 times per company
const RETRY_DELAY_MS = 100; // Wait 100ms between retries

/**
 * Result of batch aggregation
 */
export type AggregateCompaniesResult = {
  /** Number of companies successfully aggregated */
  ok: number;
  /** Number of companies that failed after all retries */
  failed: number;
};

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Aggregate a single company with retries
 *
 * @param companyId - Company to aggregate
 * @returns true if successful, false if failed after all retries
 */
async function aggregateWithRetry(companyId: number): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      aggregateCompanyAndPersist(companyId);
      return true;
    } catch (err) {
      const isLastAttempt = attempt === MAX_RETRIES + 1;
      if (isLastAttempt) {
        logger.error("Company aggregation failed after all retries", {
          companyId,
          attempts: MAX_RETRIES + 1,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      } else {
        logger.warn("Company aggregation attempt failed, will retry", {
          companyId,
          attempt,
          maxRetries: MAX_RETRIES,
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  return false; // Should never reach here
}

/**
 * Process a chunk of company IDs
 *
 * Aggregates each company sequentially within the chunk.
 * Returns counts of successful and failed aggregations.
 */
async function processChunk(
  companyIds: number[],
): Promise<AggregateCompaniesResult> {
  let ok = 0;
  let failed = 0;

  for (const companyId of companyIds) {
    const success = await aggregateWithRetry(companyId);
    if (success) {
      ok++;
    } else {
      failed++;
    }
  }

  return { ok, failed };
}

/**
 * Aggregate multiple companies in batches
 *
 * End-of-run orchestration for M4.B3.3:
 * 1. Split company IDs into chunks (avoid long blocking operations)
 * 2. Process each chunk sequentially
 * 3. For each company: read offers+matches → compute → persist
 * 4. Retry transient failures (per company)
 * 5. Log errors and continue (do not crash run)
 *
 * Idempotent: recomputes aggregation from current DB state.
 *
 * @param companyIds - Array of company IDs to aggregate (deduplicated)
 * @returns Summary with successful and failed counts
 */
export async function aggregateCompaniesAndPersist(
  companyIds: number[],
): Promise<AggregateCompaniesResult> {
  if (companyIds.length === 0) {
    logger.debug("No companies to aggregate");
    return { ok: 0, failed: 0 };
  }

  logger.info("Starting batch company aggregation", {
    totalCompanies: companyIds.length,
    chunkSize: CHUNK_SIZE,
  });

  let totalOk = 0;
  let totalFailed = 0;

  // Process in chunks
  for (let i = 0; i < companyIds.length; i += CHUNK_SIZE) {
    const chunk = companyIds.slice(i, i + CHUNK_SIZE);
    const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(companyIds.length / CHUNK_SIZE);

    logger.debug("Processing company aggregation chunk", {
      chunkIndex,
      totalChunks,
      chunkSize: chunk.length,
    });

    const result = await processChunk(chunk);
    totalOk += result.ok;
    totalFailed += result.failed;
  }

  logger.info("Batch company aggregation complete", {
    totalCompanies: companyIds.length,
    successful: totalOk,
    failed: totalFailed,
  });

  return { ok: totalOk, failed: totalFailed };
}
