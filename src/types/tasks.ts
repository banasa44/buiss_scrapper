/**
 * Task orchestration type definitions
 *
 * Types for the task-based execution engine that will replace query-based runner.
 * Tasks represent discrete pipeline stages (directory, ATS discovery, ingestion, etc.)
 */

import type { Logger } from "@/types";

/**
 * Minimal context passed to task execution
 *
 * Provides access to database and other runtime dependencies.
 * Will be expanded as needed when wiring actual task implementations.
 */
export type TaskContext = {
  /** Owner ID for the current run (UUID) */
  ownerId: string;

  /** Project logger for structured logging */
  logger: Logger;

  /** Additional context fields can be added here as needed */
  [key: string]: any;
};

/**
 * A registered task in the task orchestration engine
 *
 * Represents a single executable stage in the pipeline.
 * Tasks are executed sequentially by the orchestrator.
 */
export type Task = {
  /**
   * Stable unique identifier for this task
   * Format: <stage>:<substage> (e.g., "directory:ingest", "ats:discover")
   */
  taskKey: string;

  /**
   * Human-readable task name for logging/debugging
   * Optional but recommended
   */
  name?: string;

  /**
   * Client/provider key for pause/rate-limit grouping
   * Optional - used to group tasks that share rate limits
   * Examples: "infojobs", "lever", "greenhouse"
   */
  clientKey?: string;

  /**
   * Execute the task once
   *
   * @param ctx - Task execution context
   * @returns Promise that resolves when task completes
   * @throws Error if task execution fails
   */
  runOnce(ctx: TaskContext): Promise<void>;

  /**
   * Determine if task should be executed in current run
   *
   * Optional predicate - if omitted, task always runs.
   * Can be used for conditional execution based on state.
   *
   * @param ctx - Task execution context
   * @returns true if task should execute, false to skip
   */
  shouldRun?(ctx: TaskContext): boolean | Promise<boolean>;
};
