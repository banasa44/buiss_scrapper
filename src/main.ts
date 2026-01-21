import { InfoJobsClient } from "@/clients/infojobs";
import * as logger from "@/logger";

async function main() {
  logger.info("Starting buiss-scrapper...");
  logger.debug("Debug mode enabled");

  const client = new InfoJobsClient();
  const result = client.smoke();

  logger.info("InfoJobsClient smoke test result", { result });
}

main().catch((error) => {
  logger.error("Fatal error", { error: error.message, stack: error.stack });
  process.exit(1);
});
