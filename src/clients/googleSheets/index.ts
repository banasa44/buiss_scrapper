/**
 * Google Sheets client public API
 */

export { GoogleSheetsClient, GoogleSheetsError } from "./googleSheetsClient";
export type {
  GoogleSheetsConfig,
  GoogleSheetsCredentials,
  GoogleSheetsErrorDetails,
  SheetReadResult,
  SheetWriteResult,
  SheetAppendResult,
  SheetOperationResult,
  SheetOperationSuccess,
  SheetOperationError,
} from "@/types/clients/googleSheets";
