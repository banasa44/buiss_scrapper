/**
 * Company Sources module
 *
 * This module provides company discovery from external public directories
 * (startup hubs, company registries, etc.)
 *
 * Each source has its own subdirectory with source-specific parsing logic.
 * All sources return CompanyInput[] for consistency.
 *
 * This is NOT related to:
 * - ATS discovery (atsDiscovery module)
 * - Catalog/keyword system (catalog module)
 * - Ingestion/persistence (ingestion module)
 */

export { cataloniaDirectorySource, fetchCataloniaCompanies } from "./catalonia";
export { madrimasdDirectorySource, fetchMadrimasdCompanies } from "./madrimasd";
export { lanzaderaDirectorySource, fetchLanzaderaCompanies } from "./lanzadera";
export { ingestDirectorySources } from "./ingestDirectorySources";
