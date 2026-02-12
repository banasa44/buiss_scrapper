/**
 * ATS Orchestrator — sequential execution of ATS discovery and provider runners
 *
 * This module orchestrates ATS ingestion by executing a bounded sequence:
 * 1. ATS discovery batch (find new ATS tenants)
 * 2. Lever runner (ingest from Lever tenants)
 * 3. Greenhouse runner (ingest from Greenhouse tenants)
 *
 * Respects existing run control mechanisms:
 * - Global run lock (prevents concurrent runs)
 * - Client pause state (skips paused providers)
 * - Run lifecycle tracking (reuses existing ingestion_runs)
 */

import { randomUUID } from "crypto";
import { acquireRunLock, releaseRunLock } from "@/db/repos/runLockRepo";
import { runAtsDiscoveryBatch } from "@/atsDiscovery";
import { runLeverRunnerOnce } from "./leverRunner";
import { runGreenhouseRunnerOnce } from "./greenhouseRunner";
import * as logger from "@/logger";

/**
 * Options for ATS orchestrator
 */
export type RunAtsOrchestratorOnceOptions = {
  /** Maximum number of companies to check for ATS discovery */
  discoveryLimit?: number;
  /** Maximum number of Lever company_sources to process */
  leverLimit?: number;
  /** Maximum number of Greenhouse company_sources to process */
  greenhouseLimit?: number;
};

/**
 * Run ATS orchestrator once — execute bounded ATS sequence
 *
 * Executes a bounded sequence of ATS operations:
 * 1. Run ATS discovery batch to find new tenants
 * 2. Run Lever runner to ingest from Lever tenants
 * 3. Run Greenhouse runner to ingest from Greenhouse tenants
 *
 * Acquires the global run lock before execution and releases it on completion.
 * Each step logs its results and continues even if previous steps fail.
 *
 * @param options - Orchestrator options (discoveryLimit, leverLimit, greenhouseLimit)
 */
export async function runAtsOrchestratorOnce(
  options?: RunAtsOrchestratorOnceOptions,
): Promise<void> {
  const discoveryLimit = options?.discoveryLimit ?? 1;
  const leverLimit = options?.leverLimit ?? 1;
  const greenhouseLimit = options?.greenhouseLimit ?? 1;

  logger.info("Starting ATS orchestrator (bounded sequence)", {
    discoveryLimit,
    leverLimit,
    greenhouseLimit,
  });

  // Generate unique owner ID for this orchestrator run
  const ownerId = randomUUID();

  // Try to acquire global run lock
  logger.debug("Acquiring global run lock for ATS orchestrator", { ownerId });
  const lockResult = acquireRunLock(ownerId);

  if (!lockResult.ok) {
    logger.warn("Failed to acquire run lock - another run may be in progress", {
      reason: lockResult.reason,
    });
    return;
  }

  logger.info("Global run lock acquired for ATS orchestrator", { ownerId });

  try {
    // Step 1: ATS Discovery Batch
    logger.info("Step 1/3: Running ATS discovery batch", { discoveryLimit });
    const discoveryResult = await runAtsDiscoveryBatch({
      limit: discoveryLimit,
    });
    logger.info("ATS discovery batch completed", {
      checked: discoveryResult.checked,
      found: discoveryResult.found,
      persisted: discoveryResult.persisted,
      notFound: discoveryResult.notFound,
      error: discoveryResult.error,
    });

    // Step 2: Lever Runner
    logger.info("Step 2/3: Running Lever runner", { leverLimit });
    const leverResult = await runLeverRunnerOnce({ limit: leverLimit });
    logger.info("Lever runner completed", {
      status: leverResult.status,
      counters: leverResult.counters,
      note: leverResult.note,
    });

    // Step 3: Greenhouse Runner
    logger.info("Step 3/3: Running Greenhouse runner", { greenhouseLimit });
    const greenhouseResult = await runGreenhouseRunnerOnce({
      limit: greenhouseLimit,
    });
    logger.info("Greenhouse runner completed", {
      status: greenhouseResult.status,
      counters: greenhouseResult.counters,
      note: greenhouseResult.note,
    });

    // Summary log
    logger.info("ATS orchestrator completed (bounded sequence)", {
      discovery: {
        checked: discoveryResult.checked,
        found: discoveryResult.found,
        persisted: discoveryResult.persisted,
      },
      lever: {
        status: leverResult.status,
        processed: leverResult.counters?.offersProcessed ?? 0,
      },
      greenhouse: {
        status: greenhouseResult.status,
        processed: greenhouseResult.counters?.offersProcessed ?? 0,
      },
    });
  } finally {
    // Always release the run lock, even if an error occurred
    logger.debug("Releasing global run lock for ATS orchestrator", { ownerId });
    releaseRunLock(ownerId);
    logger.info("Global run lock released for ATS orchestrator", { ownerId });
  }
}
