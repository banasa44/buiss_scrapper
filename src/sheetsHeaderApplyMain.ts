/**
 * Explicit entrypoint: apply Companies sheet header contract once.
 *
 * This command is developer-invoked and does not run the normal pipeline.
 */

import "@/bootstrap/env";
import { randomUUID } from "crypto";
import * as logger from "@/logger";
import { findTaskByKey } from "@/tasks";

const SHEETS_HEADER_APPLY_TASK_KEY = "sheets:header:apply";

async function main() {
  logger.info("Starting explicit Companies header apply command");

  const task = findTaskByKey(SHEETS_HEADER_APPLY_TASK_KEY);
  if (!task) {
    throw new Error(
      `Task "${SHEETS_HEADER_APPLY_TASK_KEY}" is not registered`,
    );
  }

  await task.runOnce({
    ownerId: randomUUID(),
    logger,
  });

  logger.info("Explicit Companies header apply command finished");
}

main().catch((error) => {
  logger.error("Companies header apply command failed", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
