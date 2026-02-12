/**
 * Task registry — single source of truth for registered tasks
 *
 * This module will eventually replace the query-based registry (src/queries/index.ts)
 * with a task-based orchestration engine.
 *
 * Currently empty — tasks will be added incrementally as ATS and pipeline stages
 * are refactored to use the Task abstraction.
 */

import type { Task } from "@/types";
import { DirectoryIngestionTask } from "./directoryIngestionTask";
import { AtsDiscoveryTask } from "./atsDiscoveryTask";
import { LeverIngestionTask } from "./leverIngestionTask";
import { GreenhouseIngestionTask } from "./greenhouseIngestionTask";

/**
 * All registered tasks across pipeline stages
 *
 * TODO: Add tasks incrementally:
 * - [x] Directory ingestion task
 * - [x] ATS discovery task
 * - [x] Lever ingestion task
 * - [x] Greenhouse ingestion task
 * - [ ] Sheets sync task
 * - [ ] Feedback apply task
 *
 * Tasks will be executed sequentially in array order.
 */
export const ALL_TASKS: Task[] = [
  DirectoryIngestionTask,
  AtsDiscoveryTask,
  LeverIngestionTask,
  GreenhouseIngestionTask,
];

/**
 * Find a task by its taskKey
 *
 * @param taskKey - The task identifier to search for
 * @returns The task if found, null otherwise
 */
export function findTaskByKey(taskKey: string): Task | null {
  return ALL_TASKS.find((task) => task.taskKey === taskKey) ?? null;
}

/**
 * Validate task registry at load time
 *
 * Ensures:
 * - Task keys are globally unique
 * - Required fields are present and valid
 *
 * @throws Error if validation fails
 */
export function validateTaskRegistry(): void {
  // Allow empty registry during migration period
  if (ALL_TASKS.length === 0) {
    return;
  }

  const seenKeys = new Set<string>();

  for (const task of ALL_TASKS) {
    // Check required fields
    if (!task.taskKey) {
      throw new Error("Task missing required field: taskKey");
    }

    if (typeof task.runOnce !== "function") {
      throw new Error(`Task '${task.taskKey}' missing runOnce function`);
    }

    // Check taskKey uniqueness
    if (seenKeys.has(task.taskKey)) {
      throw new Error(`Duplicate taskKey '${task.taskKey}'`);
    }
    seenKeys.add(task.taskKey);

    // Validate shouldRun if present
    if (task.shouldRun !== undefined && typeof task.shouldRun !== "function") {
      throw new Error(
        `Task '${task.taskKey}' has shouldRun but it is not a function`,
      );
    }
  }
}

// Run validation at module load time
validateTaskRegistry();
