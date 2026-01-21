import { InfoJobsClient } from "@/clients/infojobs";

async function main() {
  console.log("Starting buiss-scrapper...");

  const client = new InfoJobsClient();
  const result = client.smoke();

  console.log(result);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
