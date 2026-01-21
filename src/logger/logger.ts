/**
 * Micro-logger wrapper — minimal logging with level filtering
 * No external dependencies, wraps console.*
 */

import type { LogLevel } from "@/types";
import { LOG_LEVELS } from "@/constants";

// Read from environment, default to 'info'
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const currentLevelValue = LOG_LEVELS[currentLevel];

/**
 * Format meta object as JSON string
 */
function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) {
    return "";
  }
  return " " + JSON.stringify(meta);
}

/**
 * Log message if level is enabled
 */
function log(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (LOG_LEVELS[level] >= currentLevelValue) {
    const timestamp = new Date().toISOString();
    const formattedMeta = formatMeta(meta);
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}${formattedMeta}`;

    switch (level) {
      case "debug":
      case "info":
        console.log(logMessage);
        break;
      case "warn":
        console.warn(logMessage);
        break;
      case "error":
        console.error(logMessage);
        break;
    }
  }
}

export function debug(message: string, meta?: Record<string, unknown>): void {
  log("debug", message, meta);
}

export function info(message: string, meta?: Record<string, unknown>): void {
  log("info", message, meta);
}

export function warn(message: string, meta?: Record<string, unknown>): void {
  log("warn", message, meta);
}

export function error(message: string, meta?: Record<string, unknown>): void {
  log("error", message, meta);
}

/**
 * Create a logger with bound context (meta merged into all calls)
 */
export function withContext(context: Record<string, unknown>): {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
} {
  return {
    debug: (message: string, meta?: Record<string, unknown>) =>
      debug(message, { ...context, ...meta }),
    info: (message: string, meta?: Record<string, unknown>) =>
      info(message, { ...context, ...meta }),
    warn: (message: string, meta?: Record<string, unknown>) =>
      warn(message, { ...context, ...meta }),
    error: (message: string, meta?: Record<string, unknown>) =>
      error(message, { ...context, ...meta }),
  };
}
