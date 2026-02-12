/**
 * ATS Discovery Task
 *
 * Detects ATS providers (Lever, Greenhouse) for companies with website URLs.
 * Persists discovery results as company_sources for downstream ingestion.
 *
 * This is the second stage in the pipeline, executed after directory ingestion.
 */

import type { Task, TaskContext } from "@/types";
import { runAtsDiscoveryBatch } from "@/atsDiscovery";
import { ATS_DISCOVERY_BATCH_LIMIT } from "@/constants";

/**
 * ATS Discovery task implementation
 *
 * Executes ATS detection for companies needing discovery.
 * Database must be opened before this task runs (handled by runner).
 */
export const AtsDiscoveryTask: Task = {
  taskKey: "ats:discover",
  name: "ATS Discovery Batch",
  clientKey: "atsDiscovery",

  async runOnce(ctx: TaskContext): Promise<void> {
    ctx.logger.info("Starting ATS discovery batch", {
      limit: ATS_DISCOVERY_BATCH_LIMIT,
    });

    const counters = await runAtsDiscoveryBatch({
      limit: ATS_DISCOVERY_BATCH_LIMIT,
    });

    ctx.logger.info("ATS discovery batch complete", {
      checked: counters.checked,
      found: counters.found,
      persisted: counters.persisted,
      notFound: counters.notFound,
      error: counters.error,
      persistConflict: counters.persistConflict,
    });
  },
};
