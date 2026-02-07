/**
 * InfoJobs ingestion pipeline entrypoint
 *
 * Testable pipeline that connects:
 * InfoJobs client → run lifecycle + ingestion → DB
 *
 * This pipeline is the target of E2E offline tests (mock HTTP + real DB).
 * It supports dependency injection for testing and provides a stable API.
 */

import type {
  RunInfojobsPipelineInput,
  RunInfojobsPipelineResult,
  SearchOffersQuery,
} from "@/types";
import { InfoJobsClient } from "@/clients/infojobs";
import { runOfferBatchIngestion } from "@/ingestion";
import {
  INFOJOBS_DEFAULT_MAX_PAGES,
  INFOJOBS_DEFAULT_MAX_OFFERS,
} from "@/constants/clients/infojobs";
import * as logger from "@/logger";

/**
 * Run InfoJobs ingestion pipeline
 *
 * Fetches offers from InfoJobs (or injected client) and persists them to DB.
 * Per-record failures are logged and skipped; only fatal errors throw.
 *
 * @param input - Pipeline input with optional client injection and query params
 * @returns Pipeline result with runId, ingestion result, and counters
 * @throws Only for fatal init/auth/config/db-connect errors
 */
export async function runInfojobsPipeline(
  input: RunInfojobsPipelineInput,
): Promise<RunInfojobsPipelineResult> {
  // Use injected client or create a new one
  // This enables E2E tests to provide a client with mocked HTTP layer
  const client = input.client ?? new InfoJobsClient();

  logger.debug("Starting InfoJobs pipeline", {
    provider: client.provider,
    hasInjectedClient: !!input.client,
    hasText: !!input.text,
    hasUpdatedSince: !!input.updatedSince,
  });

  // Build search query from input
  const query: SearchOffersQuery = {
    text: input.text,
    updatedSince: input.updatedSince,
    maxPages: input.maxPages ?? INFOJOBS_DEFAULT_MAX_PAGES,
    maxOffers: input.maxOffers ?? INFOJOBS_DEFAULT_MAX_OFFERS,
  };

  // Fetch offers from InfoJobs
  logger.debug("Fetching offers from InfoJobs", { query });
  const searchResult = await client.searchOffers(query);

  logger.debug("InfoJobs search complete", {
    offersFetched: searchResult.meta.offersFetched,
    pagesFetched: searchResult.meta.pagesFetched,
    truncatedBy: searchResult.meta.truncatedBy,
  });

  // Persist offers to DB via ingestion layer
  const batchResult = await runOfferBatchIngestion(
    client.provider,
    searchResult.offers,
    input.queryKey,
  );

  // Log summary
  logger.info("InfoJobs pipeline complete", {
    runId: batchResult.runId,
    provider: client.provider,
    fetched: searchResult.meta.offersFetched,
    processed: batchResult.result.processed,
    upserted: batchResult.result.upserted,
    skipped: batchResult.result.skipped,
    failed: batchResult.result.failed,
  });

  return {
    runId: batchResult.runId,
    ingestResult: batchResult.result,
    counters: batchResult.counters,
  };
}
