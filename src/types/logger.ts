/**
 * Logger type definitions
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger interface for structured logging
 *
 * Matches the signature of the project logger module (@/logger).
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
