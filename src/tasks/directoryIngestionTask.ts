/**
 * Directory Ingestion Task
 *
 * Fetches companies from directory sources (Catalonia, Madri+d, Lanzadera)
 * and persists them to the companies table.
 *
 * This is the first stage in the pipeline, executed before ATS discovery.
 */

import type { Task, TaskContext } from "@/types";
import {
  cataloniaDirectorySource,
  madrimasdDirectorySource,
  lanzaderaDirectorySource,
  ingestDirectorySources,
} from "@/companySources";

/**
 * All directory sources to ingest
 *
 * Sources are processed sequentially in array order.
 * Each source implements CompanyDirectorySource interface.
 */
const DIRECTORY_SOURCES = [
  cataloniaDirectorySource,
  madrimasdDirectorySource,
  lanzaderaDirectorySource,
];

/**
 * Directory ingestion task implementation
 *
 * Executes directory source discovery and persistence.
 * Database must be opened before this task runs (handled by runner).
 */
export const DirectoryIngestionTask: Task = {
  taskKey: "directory:ingest",
  name: "Directory Sources Ingestion",
  clientKey: "directory",

  async runOnce(ctx: TaskContext): Promise<void> {
    ctx.logger.info("Starting directory ingestion", {
      sourceCount: DIRECTORY_SOURCES.length,
    });

    const result = await ingestDirectorySources(DIRECTORY_SOURCES);

    ctx.logger.info("Directory ingestion complete", {
      sources: DIRECTORY_SOURCES.length,
      fetched: result.total.fetched,
      attempted: result.total.attempted,
      upserted: result.total.upserted,
      skipped: result.total.skipped,
      failed: result.total.failed,
    });
  },
};
