/**
 * Sheets type definitions
 *
 * Types for Google Sheets export/import operations
 */

/**
 * Resolution values for company feedback
 * Matches the enum documented in M6 lifecycle spec
 */
export type CompanyResolution =
  | "PENDING"
  | "IN_PROGRESS"
  | "HIGH_INTEREST"
  | "ALREADY_REVOLUT"
  | "ACCEPTED"
  | "REJECTED";

/**
 * Minimal company row data read from the sheet
 * Only includes the columns needed for indexing and feedback
 */
export type CompanySheetRow = {
  /** 1-based row index in the sheet (1 = header, 2+ = data rows) */
  rowIndex: number;
  /** Company ID from the DB */
  companyId: number;
  /** Client feedback resolution */
  resolution: CompanyResolution | null;
};

/**
 * Index mapping company IDs to their sheet positions
 */
export type SheetCompanyIndex = Map<number, CompanySheetRow>;

/**
 * Result of reading the company sheet
 */
export type ReadCompanySheetResult = {
  /** Index of companies found in the sheet */
  index: SheetCompanyIndex;
  /** Number of rows successfully parsed */
  validRows: number;
  /** Number of rows skipped due to parse errors */
  skippedRows: number;
};

/**
 * Export plan containing rows ready for append to sheet
 */
export type ExportPlan = {
  /** Array of rows (each row is an array of cell values) ready for Sheets API append */
  rowsForAppend: (string | number)[][];
};

/**
 * Result of appending new companies to sheet
 */
export type AppendCompaniesResult = {
  /** Whether the operation succeeded overall */
  ok: boolean;
  /** Number of companies appended to sheet */
  appendedCount: number;
  /** Number of companies skipped (already in sheet) */
  skippedCount: number;
  /** Total number of companies in DB */
  totalCompanies: number;
  /** Error message if operation failed */
  error?: string;
};

/**
 * Result of updating company metrics in sheet
 */
export type UpdateCompaniesResult = {
  /** Whether the operation succeeded overall */
  ok: boolean;
  /** Number of companies updated in sheet */
  updatedCount: number;
  /** Number of companies skipped (not in sheet) */
  skippedCount: number;
  /** Total number of companies in DB */
  totalCompanies: number;
  /** Error message if operation failed */
  error?: string;
};

/**
 * Update operation for a single company row
 * Contains row index and metric values for batch updates
 */
export type UpdateOperation = {
  /** 1-based row index in the sheet */
  rowIndex: number;
  /** Metric column values (indices 3-9) */
  metricValues: (string | number)[];
};

/**
 * Result of reading company feedback from sheet
 * Contains mapping of company_id to resolution and counters
 */
export type CompanyFeedbackReadResult = {
  /** Map of company_id to resolution value */
  map: Record<number, CompanyResolution>;
  /** Total number of rows processed (excluding header) */
  totalRows: number;
  /** Number of rows with valid company_id and resolution */
  validRows: number;
  /** Number of rows with invalid data (skipped) */
  invalidRows: number;
  /** Number of duplicate company_id rows (skipped) */
  duplicateRows: number;
};

/**
 * Single resolution change detected in feedback comparison
 * Represents a company whose resolution differs between sheet and DB
 */
export type FeedbackChange = {
  /** Company ID */
  companyId: number;
  /** Current resolution in DB (null if not set) */
  fromResolution: CompanyResolution | null;
  /** New resolution from sheet */
  toResolution: CompanyResolution;
};

/**
 * Result of comparing sheet feedback against DB state
 * Deterministic plan of what needs to change (no destructive actions)
 */
export type FeedbackChangePlan = {
  /** List of companies that need resolution updates */
  changes: FeedbackChange[];
  /** Total number of rows in sheet feedback */
  totalSheetRows: number;
  /** Number of companies from sheet that exist in DB */
  knownCompanyIds: number;
  /** Number of companies from sheet not found in DB (ignored) */
  unknownCompanyIds: number;
  /** Number of changes detected (sheet != DB) */
  changesDetected: number;
  /** Number of companies with no change (sheet == DB) */
  unchanged: number;
  /** Number of invalid rows passed through from reader */
  invalidRows: number;
};

/**
 * Classification of a feedback change based on lifecycle impact
 * Categorizes transitions according to M6 resolution semantics
 */
export type ValidatedFeedbackChange = FeedbackChange & {
  /** Classification of this change's lifecycle impact */
  classification:
    | "destructive" // Transition TO resolved (ACCEPTED/REJECTED/ALREADY_REVOLUT)
    | "reversal" // Transition FROM resolved back to active
    | "informational"; // Transition between active states only
};

/**
 * Result of validating feedback changes for lifecycle processing
 * Classifies changes by their lifecycle impact (destructive/reversal/informational)
 */
export type ValidatedFeedbackPlan = {
  /** Changes requiring offer deletion (transitions TO resolved states) */
  destructiveChanges: ValidatedFeedbackChange[];
  /** Changes requiring offer restoration (transitions FROM resolved to active) */
  reversalChanges: ValidatedFeedbackChange[];
  /** Changes with no lifecycle impact (active ↔ active) */
  informationalChanges: ValidatedFeedbackChange[];
  /** Total number of changes validated */
  totalChanges: number;
  /** Number of destructive transitions */
  destructiveCount: number;
  /** Number of reversal transitions */
  reversalCount: number;
  /** Number of informational transitions */
  informationalCount: number;
};

/**
 * Result of checking if current time is within feedback processing window
 * Used to gate destructive feedback operations (M6 nightly window)
 */
export type FeedbackWindowCheck = {
  /** Whether feedback processing is allowed at this time */
  allowed: boolean;
  /** Human-readable explanation of the decision */
  reason: string;
  /** Current hour in target timezone (for debugging) */
  currentHour?: number;
  /** Target timezone used for check */
  timezone?: string;
};

/**
 * Result of processing feedback from Google Sheets
 * Orchestrates BUILD-1 through BUILD-4 (read, compare, validate, gate)
 *
 * This is a read-only operation that produces a validated plan.
 * No DB modifications are performed at this stage.
 */
export type ProcessFeedbackResult = {
  /** Whether the operation succeeded overall */
  ok: boolean;
  /** Whether feedback processing was skipped (window gate blocked) */
  skipped: boolean;
  /** Reason for skip or error (if applicable) */
  reason?: string;
  /** Complete result from feedback reader (BUILD-1) */
  feedbackReadResult?: CompanyFeedbackReadResult;
  /** Complete change plan from comparison (BUILD-2) */
  changePlan?: FeedbackChangePlan;
  /** Validated feedback plan with classifications (BUILD-3) */
  validatedPlan?: ValidatedFeedbackPlan;
  /** Error message if operation failed */
  error?: string;
};

/**
 * Combined result of syncing companies to sheet (append + update)
 */
export type SyncCompaniesResult = {
  /** Whether both operations succeeded */
  ok: boolean;
  /** Total number of companies in DB */
  totalCompanies: number;
  /** Number of new companies appended */
  appendedCount: number;
  /** Number of existing companies updated */
  updatedCount: number;
  /** Number of companies skipped (neither appended nor updated) */
  skippedCount: number;
  /** Error messages if any operation failed */
  errors?: string[];
};
