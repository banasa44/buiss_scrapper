/**
 * Runner core — executes registered queries sequentially with state management
 *
 * This module implements the orchestration logic for running all registered
 * queries once, with proper locking, state transitions, and error handling.
 *
 * Key responsibilities:
 * - Acquire global run lock (prevent concurrent executions)
 * - Ensure query_state rows exist for all registered queries
 * - Execute queries sequentially, grouped by client
 * - Handle errors with retry logic (max 3 attempts)
 * - Classify errors: RATE_LIMIT, TRANSIENT, FATAL
 * - Pause clients on rate limit (6 hours)
 * - Add jitter between queries (10-60s)
 * - Persist queryKey in ingestion_runs for history
 */

import { randomUUID } from "crypto";
import type {
  RegisteredQuery,
  ErrorClassification,
  SearchOffersQuery,
} from "@/types";
import { ALL_QUERIES } from "@/queries";
import { openDb, runMigrations } from "@/db";
import {
  getQueryState,
  upsertQueryState,
  markQueryRunning,
  markQuerySuccess,
  markQueryError,
  listQueryStates,
} from "@/db/repos/queryStateRepo";
import { acquireRunLock, releaseRunLock } from "@/db/repos/runLockRepo";
import {
  isClientPaused as isClientPausedDb,
  setClientPause,
  getClientPause,
  listClientPauses,
} from "@/db/repos/clientPauseRepo";
import { getLatestRunByQueryKey } from "@/db/repos/runsRepo";
import { runInfojobsPipeline } from "@/ingestion/pipelines/infojobs";
import { InfoJobsClient } from "@/clients/infojobs";
import {
  MAX_RETRIES_PER_QUERY,
  CLIENT_PAUSE_DURATION_SECONDS,
  QUERY_JITTER_MIN_MS,
  QUERY_JITTER_MAX_MS,
  CYCLE_SLEEP_MIN_MS,
  CYCLE_SLEEP_MAX_MS,
} from "@/constants";
import * as logger from "@/logger";

/**
 * Classify error for retry and pause decisions
 *
 * - RATE_LIMIT: HTTP 429 or provider-specific rate limit signals
 * - TRANSIENT: Timeouts, 5xx errors, network failures
 * - FATAL: Missing credentials, invalid config, schema mismatch
 *
 * @param error - The error object
 * @returns Error classification
 */
function classifyError(error: unknown): ErrorClassification {
  if (!(error instanceof Error)) {
    return "TRANSIENT";
  }

  const message = error.message.toLowerCase();

  // FATAL: auth/config errors
  if (
    message.includes("authentication") ||
    message.includes("missing") ||
    message.includes("invalid config") ||
    message.includes("credentials")
  ) {
    return "FATAL";
  }

  // RATE_LIMIT: HTTP 429 or explicit rate limit messages
  if (message.includes("429") || message.includes("rate limit")) {
    return "RATE_LIMIT";
  }

  // TRANSIENT: timeouts, 5xx, network errors
  if (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    /5\d{2}/.test(message) // 500, 502, 503, 504
  ) {
    return "TRANSIENT";
  }

  // Default to TRANSIENT (safer to retry than to give up)
  return "TRANSIENT";
}

/**
 * Get error code string for query_state persistence
 *
 * @param classification - Error classification
 * @returns Short error code (e.g., "RATE_LIMIT", "HTTP_5XX", "AUTH")
 */
function getErrorCode(classification: ErrorClassification): string {
  return classification;
}

/**
 * Extract short error message for query_state persistence
 *
 * @param error - The error object
 * @returns Truncated error message (max 500 chars)
 */
function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? message.substring(0, 497) + "..." : message;
}

/**
 * Sleep for a random jitter duration
 *
 * @param minMs - Minimum sleep duration (milliseconds)
 * @param maxMs - Maximum sleep duration (milliseconds)
 */
async function sleepJitter(minMs: number, maxMs: number): Promise<void> {
  const jitter = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  logger.debug("Sleeping for jitter", { jitterMs: jitter });
  await new Promise((resolve) => setTimeout(resolve, jitter));
}

/**
 * Pause client due to rate limiting
 *
 * Persists pause state to database with expiry timestamp.
 *
 * @param client - Client identifier
 * @param durationSeconds - Pause duration in seconds
 */
function pauseClient(client: string, durationSeconds: number): void {
  const pauseUntil = new Date(Date.now() + durationSeconds * 1000);
  setClientPause(client, pauseUntil.toISOString(), { reason: "RATE_LIMIT" });
  logger.warn("Client paused due to rate limit", {
    client,
    pauseUntil: pauseUntil.toISOString(),
    durationSeconds,
  });
}

/**
 * Execute a single query with retry logic
 *
 * @param query - The registered query to execute
 * @returns true if successful, false if failed (after retries)
 */
async function executeQuery(query: RegisteredQuery): Promise<boolean> {
  const startMs = Date.now();

  logger.info("Executing query", {
    queryKey: query.queryKey,
    client: query.client,
    name: query.name,
  });

  // Mark query as running
  markQueryRunning(query.queryKey);

  let lastError: Error | null = null;
  let attempts = 0;

  while (attempts < MAX_RETRIES_PER_QUERY) {
    attempts++;

    try {
      // Execute query based on client type
      if (query.client === "infojobs") {
        const client = new InfoJobsClient();
        await runInfojobsPipeline({
          client,
          text: query.params.text,
          updatedSince: query.params.updatedSince,
          maxPages: query.params.maxPages,
          maxOffers: query.params.maxOffers,
          queryKey: query.queryKey,
        });
      } else {
        throw new Error(`Unsupported client: ${query.client}`);
      }

      // Success!
      markQuerySuccess(query.queryKey);

      // Fetch run metrics
      const elapsedMs = Date.now() - startMs;
      const run = getLatestRunByQueryKey(query.queryKey);

      logger.info("Query executed successfully", {
        queryKey: query.queryKey,
        client: query.client,
        name: query.name,
        status: "SUCCESS",
        attempts,
        elapsedMs,
        ...(run && {
          runId: run.id,
          pages_fetched: run.pages_fetched,
          offers_fetched: run.offers_fetched,
          companies_aggregated: run.companies_aggregated,
          companies_failed: run.companies_failed,
          http_429_count: run.http_429_count,
        }),
      });
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const classification = classifyError(error);

      logger.warn("Query execution failed", {
        queryKey: query.queryKey,
        client: query.client,
        name: query.name,
        attempt: attempts,
        maxRetries: MAX_RETRIES_PER_QUERY,
        errorClassification: classification,
        error: getErrorMessage(error),
      });

      // FATAL errors should not be retried
      if (classification === "FATAL") {
        logger.error("Query failed with FATAL error (no retry)", {
          queryKey: query.queryKey,
          client: query.client,
          name: query.name,
          error: getErrorMessage(error),
        });
        break;
      }

      // RATE_LIMIT: pause client and break (no more retries for this query)
      if (classification === "RATE_LIMIT") {
        pauseClient(query.client, CLIENT_PAUSE_DURATION_SECONDS);
        break;
      }

      // TRANSIENT: retry if attempts remain
      if (attempts < MAX_RETRIES_PER_QUERY) {
        logger.debug("Retrying query after transient error", {
          queryKey: query.queryKey,
          attempt: attempts,
          maxRetries: MAX_RETRIES_PER_QUERY,
        });
        // Small backoff between retries (2 seconds)
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  // If we reach here, all retries exhausted or non-retryable error
  const classification = classifyError(lastError);
  markQueryError(query.queryKey, undefined, {
    errorCode: getErrorCode(classification),
    errorMessage: getErrorMessage(lastError),
  });

  // Fetch partial run metrics (may exist even on failure)
  const elapsedMs = Date.now() - startMs;
  const run = getLatestRunByQueryKey(query.queryKey);

  logger.error("Query failed after all retries", {
    queryKey: query.queryKey,
    client: query.client,
    name: query.name,
    status: "ERROR",
    attempts,
    elapsedMs,
    error_code: getErrorCode(classification),
    error_message: getErrorMessage(lastError),
    ...(run && {
      runId: run.id,
      pages_fetched: run.pages_fetched,
      offers_fetched: run.offers_fetched,
      http_429_count: run.http_429_count,
    }),
  });

  return false;
}

/**
 * Ensure query_state rows exist for all registered queries
 *
 * Upserts missing rows with IDLE status. Existing rows are not modified.
 */
function ensureQueryStateRows(): void {
  logger.debug("Ensuring query_state rows exist", {
    totalQueries: ALL_QUERIES.length,
  });

  for (const query of ALL_QUERIES) {
    const existing = getQueryState(query.queryKey);
    if (!existing) {
      upsertQueryState({
        query_key: query.queryKey,
        client: query.client,
        name: query.name,
        status: "IDLE",
      });
      logger.debug("Created query_state row", {
        queryKey: query.queryKey,
        client: query.client,
        name: query.name,
      });
    }
  }
}

/**
 * Run all registered queries once, sequentially
 *
 * This is the main entry point for the runner core.
 * It acquires the global run lock, ensures query_state rows exist,
 * and executes all queries with proper error handling and client pausing.
 *
 * Queries are executed in the order they appear in ALL_QUERIES.
 * Queries for paused clients are skipped.
 *
 * @returns Statistics about the run (total, success, failed, skipped)
 */
export async function runOnce(): Promise<{
  total: number;
  success: number;
  failed: number;
  skipped: number;
}> {
  const cycleStartMs = Date.now();
  logger.info("Starting runner (single pass)");

  // Open database and run migrations
  logger.debug("Opening database and running migrations");
  openDb();
  runMigrations();

  // Generate unique owner ID for this run
  const ownerId = randomUUID();

  // Try to acquire global run lock
  logger.debug("Acquiring global run lock", { ownerId });
  const lockResult = acquireRunLock(ownerId);

  if (!lockResult.ok) {
    logger.warn("Failed to acquire run lock - another run may be in progress", {
      reason: lockResult.reason,
    });
    return { total: 0, success: 0, failed: 0, skipped: 0 };
  }

  logger.info("Global run lock acquired", { ownerId });

  try {
    // Ensure query_state rows exist for all registered queries
    ensureQueryStateRows();

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // Execute queries sequentially
    for (let i = 0; i < ALL_QUERIES.length; i++) {
      const query = ALL_QUERIES[i];

      // Check if client is paused (using persistent DB state)
      if (isClientPausedDb(query.client)) {
        const pauseInfo = getClientPause(query.client);
        logger.info("Query skipped (client paused)", {
          queryKey: query.queryKey,
          client: query.client,
          name: query.name,
          status: "SKIPPED",
          paused_until: pauseInfo?.paused_until,
          reason: pauseInfo?.reason,
        });
        skippedCount++;
        continue;
      }

      // Execute query
      const success = await executeQuery(query);
      if (success) {
        successCount++;
      } else {
        failedCount++;
      }

      // Sleep jitter between queries (except after last query)
      if (i < ALL_QUERIES.length - 1) {
        await sleepJitter(QUERY_JITTER_MIN_MS, QUERY_JITTER_MAX_MS);
      }
    }

    // Log summary
    const cycleElapsedMs = Date.now() - cycleStartMs;
    const pausedClients = listClientPauses();
    const allStates = listQueryStates();
    const topFailures = allStates
      .filter((s) => s.consecutive_failures > 0)
      .sort((a, b) => b.consecutive_failures - a.consecutive_failures)
      .slice(0, 2);

    logger.info("Runner completed (single pass)", {
      total: ALL_QUERIES.length,
      success: successCount,
      failed: failedCount,
      skipped: skippedCount,
      elapsedMs: cycleElapsedMs,
      pausedClients: pausedClients.length,
      ...(pausedClients.length > 0 && {
        paused: pausedClients.map((p) => ({
          client: p.client,
          paused_until: p.paused_until,
          reason: p.reason,
        })),
      }),
      ...(topFailures.length > 0 && {
        topFailures: topFailures.map((f) => ({
          queryKey: f.query_key,
          consecutive_failures: f.consecutive_failures,
          error_code: f.error_code,
        })),
      }),
    });

    return {
      total: ALL_QUERIES.length,
      success: successCount,
      failed: failedCount,
      skipped: skippedCount,
    };
  } finally {
    // Always release the lock
    logger.debug("Releasing global run lock", { ownerId });
    const released = releaseRunLock(ownerId);
    if (released) {
      logger.info("Global run lock released", { ownerId });
    } else {
      logger.warn("Failed to release run lock (may not be owned)", { ownerId });
    }
  }
}

/**
 * Run queries continuously in an infinite loop
 *
 * Executes runOnce() repeatedly with cycle-level sleep between iterations.
 * Handles graceful shutdown on SIGINT/SIGTERM signals.
 * Non-fatal errors from runOnce() are caught and logged; loop continues.
 *
 * This function runs forever until the process is terminated.
 */
export async function runForever(): Promise<void> {
  logger.info("Starting continuous runner (forever mode)");

  // Register signal handlers for graceful shutdown
  let shutdownRequested = false;

  const handleShutdown = (signal: string) => {
    if (shutdownRequested) {
      logger.warn("Forced shutdown - exiting immediately");
      process.exit(1);
    }
    logger.info("Shutdown signal received, will stop after current cycle", {
      signal,
    });
    shutdownRequested = true;
  };

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  let cycleCount = 0;

  while (!shutdownRequested) {
    cycleCount++;

    try {
      logger.info("Starting runner cycle", { cycleCount });

      const result = await runOnce();

      logger.info("Runner cycle completed", {
        cycleCount,
        total: result.total,
        success: result.success,
        failed: result.failed,
        skipped: result.skipped,
      });
    } catch (error) {
      // Catch non-fatal errors from runOnce() and continue
      logger.error("Runner cycle failed with error", {
        cycleCount,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Short fallback sleep before retrying (2 minutes)
      logger.info("Sleeping before retry after error", {
        sleepMs: 120000,
      });
      await new Promise((resolve) => setTimeout(resolve, 120000));
      continue;
    }

    if (shutdownRequested) {
      logger.info("Shutdown requested, exiting loop");
      break;
    }

    // Sleep between cycles with jitter
    const sleepMs =
      CYCLE_SLEEP_MIN_MS +
      Math.random() * (CYCLE_SLEEP_MAX_MS - CYCLE_SLEEP_MIN_MS);
    logger.info("Cycle complete, sleeping before next iteration", {
      cycleCount,
      sleepMs: Math.round(sleepMs),
    });
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }

  logger.info("Continuous runner stopped", { totalCycles: cycleCount });
}
