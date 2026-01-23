import "dotenv/config";
import { InfoJobsClient } from "@/clients/infojobs";
import * as logger from "@/logger";

async function main() {
  logger.info("Starting buiss-scrapper...");
  logger.debug("Debug mode enabled");

  const client = new InfoJobsClient();
  logger.info("InfoJobsClient initialized", { provider: client.provider });

  // TODO: Add search/detail calls once implemented
}

main().catch((error) => {
  logger.error("Fatal error", { error: error.message, stack: error.stack });
  process.exit(1);
});
