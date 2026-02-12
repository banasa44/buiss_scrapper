/**
 * Greenhouse ATS runner — single bounded cycle
 *
 * Runs ONE Greenhouse ingestion cycle by calling the existing Greenhouse pipeline.
 * Does not reimplement ingestion logic; simply wraps the pipeline call
 * and returns a standardized AtsRunnerResult.
 */

import type { AtsRunnerResult } from "@/types";
import { isClientPaused, getClientPause } from "@/db/repos/clientPauseRepo";
import { runGreenhousePipeline } from "@/ingestion/pipelines/greenhouse";
import * as logger from "@/logger";

/**
 * Options for Greenhouse runner
 */
export type RunGreenhouseRunnerOnceOptions = {
  /** Maximum number of Greenhouse company_sources to process */
  limit: number;
};

/**
 * Run Greenhouse ATS runner once — execute one bounded Greenhouse ingestion cycle
 *
 * Checks if Greenhouse client is paused before executing.
 * Calls the existing runGreenhousePipeline and converts the result to AtsRunnerResult.
 *
 * Status determination:
 * - PAUSED: Greenhouse client is paused (e.g., rate limit)
 * - DONE: Pipeline executed successfully (with or without work)
 *   - If no offers processed, includes note "no_work"
 * - ERROR: Pipeline threw an error
 *
 * @param options - Runner options (limit)
 * @returns ATS runner result with status and counters
 */
export async function runGreenhouseRunnerOnce(
  options: RunGreenhouseRunnerOnceOptions,
): Promise<AtsRunnerResult> {
  const { limit } = options;

  logger.info("Starting Greenhouse runner", { provider: "greenhouse", limit });

  // Check if Greenhouse client is paused
  if (isClientPaused("greenhouse")) {
    const pauseInfo = getClientPause("greenhouse");
    logger.info("Greenhouse runner skipped (client paused)", {
      provider: "greenhouse",
      status: "PAUSED",
      paused_until: pauseInfo?.paused_until,
      reason: pauseInfo?.reason,
    });

    return {
      provider: "greenhouse",
      status: "PAUSED",
      counters: {},
    };
  }

  try {
    // Call existing Greenhouse pipeline
    const pipelineResult = await runGreenhousePipeline({ limit });

    // Extract counters from pipeline result
    const offersProcessed = pipelineResult.result.processed;
    const offersUpserted = pipelineResult.result.upserted;
    const offersSkipped = pipelineResult.result.skipped;
    const offersFailed = pipelineResult.result.failed;
    const affectedCompanies = pipelineResult.result.affectedCompanies;

    // Build counters object
    const counters: Record<string, number> = {
      offersProcessed,
      offersUpserted,
      offersSkipped,
      offersFailed,
      affectedCompanies,
    };

    // Check if no work was done
    const hasNoWork = offersProcessed === 0;

    logger.info("Greenhouse runner completed", {
      provider: "greenhouse",
      status: "DONE",
      runId: pipelineResult.runId,
      hasNoWork,
      counters,
    });

    return {
      provider: "greenhouse",
      status: "DONE",
      counters,
      ...(hasNoWork && { note: "no_work" }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("Greenhouse runner failed", {
      provider: "greenhouse",
      status: "ERROR",
      error: errorMessage,
    });

    return {
      provider: "greenhouse",
      status: "ERROR",
      counters: {},
      note: errorMessage,
    };
  }
}
