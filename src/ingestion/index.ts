/**
 * Ingestion module barrel exports
 */

export {
  startRun,
  finishRun,
  withRun,
  createRunAccumulator,
} from "./runLifecycle";

export { persistCompanyAndSource } from "./companyPersistence";

export { persistOffer } from "./offerPersistence";

export { ingestOffers } from "./ingestOffers";

export { aggregateCompaniesAndPersist } from "./aggregateCompanies";

export { runOfferBatchIngestion } from "./runOfferBatch";

export { runInfojobsPipeline } from "./pipelines";
