import "@/bootstrap/env";
import { runOnce, runForever } from "@/orchestration/runner";
import * as logger from "@/logger";

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
        logger.warn("Some tasks failed - exiting with code 1");
        process.exit(1);
      } else {
        logger.info("All tasks completed successfully - exiting with code 0");
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

main().catch((error) => {
  logger.error("Fatal error", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
