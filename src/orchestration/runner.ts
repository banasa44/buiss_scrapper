/**
 * Runner core — executes registered tasks sequentially with state management
 *
 * Key responsibilities:
 * - Acquire global run lock (prevent concurrent executions)
 * - Execute tasks sequentially in registry order
 */

import { randomUUID } from "crypto";
import type { TaskContext } from "@/types";
import { ALL_TASKS } from "@/tasks";
import { openDb, closeDb, runMigrations } from "@/db";
import {
  acquireRunLock,
  releaseRunLock,
  refreshRunLock,
} from "@/db/repos/runLockRepo";
import {
  CYCLE_SLEEP_MIN_MS,
  CYCLE_SLEEP_MAX_MS,
  RUN_LOCK_REFRESH_INTERVAL_MS,
} from "@/constants";
import * as logger from "@/logger";

/**
 * Run all registered tasks once, sequentially
 *
 * This is the main entry point for the runner core.
 * It acquires the global run lock and executes all tasks in order.
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

  try {
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
      logger.warn(
        "Failed to acquire run lock - another run may be in progress",
        {
          reason: lockResult.reason,
        },
      );
      return { total: 0, success: 0, failed: 0, skipped: 0 };
    }

    logger.info("Global run lock acquired", { ownerId });

    // Start heartbeat to refresh lock periodically
    let refreshFailureCount = 0;
    const heartbeatInterval = setInterval(() => {
      const refreshed = refreshRunLock(ownerId);
      if (refreshed) {
        logger.debug("Run lock refreshed", { ownerId });
        refreshFailureCount = 0; // Reset on success
      } else {
        refreshFailureCount++;
        logger.warn("Failed to refresh run lock", {
          ownerId,
          consecutiveFailures: refreshFailureCount,
        });
        // Continue execution - lock will eventually expire if process is unhealthy
      }
    }, RUN_LOCK_REFRESH_INTERVAL_MS);

    try {
      let successCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      // Execute tasks sequentially (if any)
      if (ALL_TASKS.length > 0) {
        logger.debug("Executing tasks", { taskCount: ALL_TASKS.length });

        const taskContext: TaskContext = {
          ownerId,
          logger,
        };

        for (const task of ALL_TASKS) {
          try {
            // Check if task should run
            if (task.shouldRun) {
              const shouldRun = await task.shouldRun(taskContext);
              if (!shouldRun) {
                logger.debug("Task skipped (shouldRun returned false)", {
                  taskKey: task.taskKey,
                  name: task.name,
                });
                skippedCount++;
                continue;
              }
            }

            logger.debug("Executing task", {
              taskKey: task.taskKey,
              name: task.name,
            });

            await task.runOnce(taskContext);

            logger.debug("Task completed", {
              taskKey: task.taskKey,
              name: task.name,
            });
            successCount++;
          } catch (error) {
            failedCount++;
            logger.error("Task execution failed", {
              taskKey: task.taskKey,
              name: task.name,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
            // Continue with next task (tasks are independent)
          }
        }
      }

      // Log summary
      const cycleElapsedMs = Date.now() - cycleStartMs;

      logger.info("Runner completed (single pass)", {
        total: ALL_TASKS.length,
        success: successCount,
        failed: failedCount,
        skipped: skippedCount,
        elapsedMs: cycleElapsedMs,
      });

      return {
        total: ALL_TASKS.length,
        success: successCount,
        failed: failedCount,
        skipped: skippedCount,
      };
    } finally {
      // Stop heartbeat
      clearInterval(heartbeatInterval);
      logger.debug("Heartbeat stopped", { ownerId });

      // Always release the lock
      logger.debug("Releasing global run lock", { ownerId });
      const released = releaseRunLock(ownerId);
      if (released) {
        logger.info("Global run lock released", { ownerId });
      } else {
        logger.warn("Failed to release run lock (may not be owned)", {
          ownerId,
        });
      }
    }
  } finally {
    // Always close database connection
    logger.debug("Closing database connection");
    closeDb();
  }
}

/**
 * Run tasks continuously in an infinite loop
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
