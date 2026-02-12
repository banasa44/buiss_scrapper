/**
 * Lever ATS runner — single bounded cycle
 *
 * Runs ONE Lever ingestion cycle by calling the existing Lever pipeline.
 * Does not reimplement ingestion logic; simply wraps the pipeline call
 * and returns a standardized AtsRunnerResult.
 */

import type { AtsRunnerResult } from "@/types";
import { isClientPaused, getClientPause } from "@/db/repos/clientPauseRepo";
import { runLeverPipeline } from "@/ingestion/pipelines/lever";
import * as logger from "@/logger";

/**
 * Options for Lever runner
 */
export type RunLeverRunnerOnceOptions = {
  /** Maximum number of Lever company_sources to process */
  limit: number;
};

/**
 * Run Lever ATS runner once — execute one bounded Lever ingestion cycle
 *
 * Checks if Lever client is paused before executing.
 * Calls the existing runLeverPipeline and converts the result to AtsRunnerResult.
 *
 * Status determination:
 * - PAUSED: Lever client is paused (e.g., rate limit)
 * - DONE: Pipeline executed successfully (with or without work)
 *   - If no offers processed, includes note "no_work"
 * - ERROR: Pipeline threw an error
 *
 * @param options - Runner options (limit)
 * @returns ATS runner result with status and counters
 */
export async function runLeverRunnerOnce(
  options: RunLeverRunnerOnceOptions,
): Promise<AtsRunnerResult> {
  const { limit } = options;

  logger.info("Starting Lever runner", { provider: "lever", limit });

  // Check if Lever client is paused
  if (isClientPaused("lever")) {
    const pauseInfo = getClientPause("lever");
    logger.info("Lever runner skipped (client paused)", {
      provider: "lever",
      status: "PAUSED",
      paused_until: pauseInfo?.paused_until,
      reason: pauseInfo?.reason,
    });

    return {
      provider: "lever",
      status: "PAUSED",
      counters: {},
    };
  }

  try {
    // Call existing Lever pipeline
    const pipelineResult = await runLeverPipeline({ limit });

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

    logger.info("Lever runner completed", {
      provider: "lever",
      status: "DONE",
      runId: pipelineResult.runId,
      hasNoWork,
      counters,
    });

    return {
      provider: "lever",
      status: "DONE",
      counters,
      ...(hasNoWork && { note: "no_work" }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("Lever runner failed", {
      provider: "lever",
      status: "ERROR",
      error: errorMessage,
    });

    return {
      provider: "lever",
      status: "ERROR",
      counters: {},
      note: errorMessage,
    };
  }
}
