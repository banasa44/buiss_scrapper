/**
 * Runner entrypoint — executes all registered queries sequentially
 *
 * This is the main entry point for the runner core (M7 orchestration).
 * It runs all queries once, then exits.
 *
 * Usage:
 *   npm run build && node dist/runnerMain.js
 *
 * Environment variables required:
 *   - IJ_CLIENT_ID: InfoJobs API client ID
 *   - IJ_CLIENT_SECRET: InfoJobs API client secret
 *   - LOG_LEVEL: Logging level (debug, info, warn, error)
 *   - DB_PATH: Path to SQLite database file (optional, defaults to data/app.db)
 *   - GOOGLE_SHEETS_SPREADSHEET_ID: Spreadsheet ID for Sheets export (optional)
 *   - GOOGLE_SERVICE_ACCOUNT_KEY_FILE: Path to Google service account JSON (optional)
 */

import "dotenv/config";
import { runOnce } from "./orchestration/runner";
import * as logger from "./logger";

async function main() {
  logger.info("Starting runner (single pass mode)");

  try {
    const result = await runOnce();

    logger.info("Runner finished", {
      total: result.total,
      success: result.success,
      failed: result.failed,
      skipped: result.skipped,
    });

    // Exit with appropriate code
    if (result.failed > 0) {
      logger.warn("Some queries failed - exiting with code 1");
      process.exit(1);
    } else {
      logger.info("All queries completed successfully - exiting with code 0");
      process.exit(0);
    }
  } catch (error) {
    logger.error("Runner failed with fatal error", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

main();
