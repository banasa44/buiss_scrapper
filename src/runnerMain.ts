/**
 * Runner entrypoint — executes all registered queries sequentially
 *
 * This is the main entry point for the runner core (M7 orchestration).
 * Supports two modes:
 * - once: Runs all queries once, then exits
 * - forever: Runs continuously in a loop until process terminated
 *
 * Usage:
 *   # Single pass (default)
 *   npm run build && node dist/runnerMain.js
 *   RUN_MODE=once npm run build && node dist/runnerMain.js
 *
 *   # Continuous mode
 *   RUN_MODE=forever npm run build && node dist/runnerMain.js
 *
 * Environment variables required:
 *   - RUN_MODE: Execution mode (once|forever, defaults to once)
 *   - IJ_CLIENT_ID: InfoJobs API client ID
 *   - IJ_CLIENT_SECRET: InfoJobs API client secret
 *   - LOG_LEVEL: Logging level (debug, info, warn, error)
 *   - DB_PATH: Path to SQLite database file (optional, defaults to data/app.db)
 *   - GOOGLE_SHEETS_SPREADSHEET_ID: Spreadsheet ID for Sheets export (optional)
 *   - GOOGLE_SERVICE_ACCOUNT_KEY_FILE: Path to Google service account JSON (optional)
 */

import "dotenv/config";
import { runOnce, runForever } from "./orchestration/runner";
import * as logger from "./logger";

async function main() {
  const runMode = (process.env.RUN_MODE || "once").toLowerCase();

  if (runMode === "forever") {
    logger.info("Starting runner (continuous mode)");
    // runForever never returns (runs until killed)
    await runForever();
  } else if (runMode === "once") {
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
  } else {
    logger.error("Invalid RUN_MODE", {
      runMode,
      validModes: ["once", "forever"],
    });
    console.error("Error: RUN_MODE must be 'once' or 'forever'");
    process.exit(1);
  }
}

main();
