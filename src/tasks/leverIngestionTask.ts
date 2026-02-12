/**
 * Lever Ingestion Task
 *
 * Fetches job offers from Lever ATS for companies with lever company_sources.
 * Persists offers and aggregates affected companies.
 *
 * This is the third stage in the pipeline, executed after ATS discovery.
 */

import type { Task, TaskContext } from "@/types";
import { runLeverPipeline } from "@/ingestion/pipelines";
import { LEVER_INGESTION_DEFAULT_LIMIT } from "@/constants";

/**
 * Lever ingestion task implementation
 *
 * Executes Lever ATS ingestion pipeline for discovered Lever tenants.
 * Database must be opened before this task runs (handled by runner).
 */
export const LeverIngestionTask: Task = {
  taskKey: "ats:lever:ingest",
  name: "Lever ATS Ingestion",
  clientKey: "lever",

  async runOnce(ctx: TaskContext): Promise<void> {
    ctx.logger.info("Starting Lever ingestion pipeline", {
      limit: LEVER_INGESTION_DEFAULT_LIMIT,
    });

    const pipelineResult = await runLeverPipeline({
      limit: LEVER_INGESTION_DEFAULT_LIMIT,
    });

    ctx.logger.info("Lever ingestion pipeline complete", {
      runId: pipelineResult.runId,
      processed: pipelineResult.result.processed,
      upserted: pipelineResult.result.upserted,
      skipped: pipelineResult.result.skipped,
      failed: pipelineResult.result.failed,
      affectedCompanies: pipelineResult.result.affectedCompanies,
      companiesAggregated: pipelineResult.counters.companies_aggregated ?? 0,
      companiesFailed: pipelineResult.counters.companies_failed ?? 0,
    });
  },
};
