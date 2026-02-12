/**
 * Greenhouse Ingestion Task
 *
 * Fetches job offers from Greenhouse ATS for companies with greenhouse company_sources.
 * Persists offers and aggregates affected companies.
 *
 * This is the fourth stage in the pipeline, executed after Lever ingestion.
 */

import type { Task, TaskContext } from "@/types";
import { runGreenhousePipeline } from "@/ingestion/pipelines";
import { GREENHOUSE_INGESTION_DEFAULT_LIMIT } from "@/constants";

/**
 * Greenhouse ingestion task implementation
 *
 * Executes Greenhouse ATS ingestion pipeline for discovered Greenhouse boards.
 * Database must be opened before this task runs (handled by runner).
 */
export const GreenhouseIngestionTask: Task = {
  taskKey: "ats:greenhouse:ingest",
  name: "Greenhouse ATS Ingestion",
  clientKey: "greenhouse",

  async runOnce(ctx: TaskContext): Promise<void> {
    ctx.logger.info("Starting Greenhouse ingestion pipeline", {
      limit: GREENHOUSE_INGESTION_DEFAULT_LIMIT,
    });

    const pipelineResult = await runGreenhousePipeline({
      limit: GREENHOUSE_INGESTION_DEFAULT_LIMIT,
    });

    ctx.logger.info("Greenhouse ingestion pipeline complete", {
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
