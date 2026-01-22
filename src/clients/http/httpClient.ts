/**
 * HTTP client wrapper — general-purpose JSON client using native fetch
 * Supports timeouts, query params, retries with exponential backoff, and structured error handling
 */

import type { HttpRequest } from "@/types/clients/http";
import { HttpError } from "@/types/clients/http";
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_JSON_HEADERS,
  ERROR_BODY_SNIPPET_MAX_LENGTH,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_MAX_RETRY_AFTER_MS,
  RETRYABLE_HTTP_METHODS,
  RETRYABLE_STATUS_CODES,
} from "@/constants/clients/http";
import * as logger from "@/logger";

/**
 * Build URL with query parameters (supports arrays for repeated params)
 */
function buildUrl(
  baseUrl: string,
  query?: Record<string, string | number | boolean | Array<string | number | boolean>>,
): string {
  if (!query || Object.keys(query).length === 0) {
    return baseUrl;
  }

  const url = new URL(baseUrl);
  Object.entries(query).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      // Append each array element as a repeated query param
      value.forEach((item) => url.searchParams.append(key, String(item)));
    } else {
      url.searchParams.append(key, String(value));
    }
  });

  return url.toString();
}

/**
 * Extract a snippet of the error response body for debugging
 */
async function extractBodySnippet(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) {
      return undefined;
    }
    return text.length > ERROR_BODY_SNIPPET_MAX_LENGTH
      ? text.substring(0, ERROR_BODY_SNIPPET_MAX_LENGTH) + "..."
      : text;
  } catch {
    return undefined;
  }
}

/**
 * Check if an HTTP method is safe to retry (idempotent)
 */
function isMethodRetryable(method: string): boolean {
  return RETRYABLE_HTTP_METHODS.includes(method as any);
}

/**
 * Check if an HTTP status code warrants a retry
 */
function isStatusRetryable(status: number): boolean {
  return RETRYABLE_STATUS_CODES.includes(status);
}

/**
 * Check if an error is retryable
 * Returns true for network errors, timeouts, and retryable HTTP status codes
 */
function isErrorRetryable(error: unknown, method: string): boolean {
  // Only retry idempotent methods
  if (!isMethodRetryable(method)) {
    return false;
  }

  // HttpError with retryable status
  if (error instanceof HttpError) {
    return isStatusRetryable(error.status);
  }

  // Network errors and timeouts are retryable
  // AbortError (timeout), TypeError (network), etc.
  if (error instanceof Error) {
    return error.name === "AbortError" || error.name === "TypeError";
  }

  return false;
}

/**
 * Parse Retry-After header value
 * Supports both delay-seconds (number) and HTTP-date formats
 * Returns delay in milliseconds, or null if invalid/missing
 */
function parseRetryAfter(retryAfterHeader: string | null): number | null {
  if (!retryAfterHeader) {
    return null;
  }

  // Try parsing as seconds (numeric)
  const seconds = parseInt(retryAfterHeader, 10);
  if (!isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  // Try parsing as HTTP date
  const date = new Date(retryAfterHeader);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

/**
 * Compute exponential backoff delay with jitter
 * Formula: min(maxDelay, baseDelay * 2^(attempt-1)) * (0.5 + random(0.5))
 * Jitter reduces thundering herd problem
 */
function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  const jitter = 0.5 + Math.random() * 0.5; // Random between 0.5 and 1.0
  return Math.floor(cappedDelay * jitter);
}

/**
 * Compute retry delay considering Retry-After header and exponential backoff
 */
function computeRetryDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  maxRetryAfterMs: number,
  retryAfterHeader: string | null,
): number {
  // Check for Retry-After header
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  if (retryAfterMs !== null) {
    // Respect Retry-After but clamp to max
    return Math.min(retryAfterMs, maxRetryAfterMs);
  }

  // Fall back to exponential backoff with jitter
  return computeBackoffDelay(attempt, baseDelayMs, maxDelayMs);
}

/**
 * Sleep for the specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform a single HTTP request attempt (no retries)
 */
async function performRequest<T>(
  req: HttpRequest,
  url: string,
  timeoutMs: number,
): Promise<T> {
  // Setup timeout using AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Build headers - defaults first, caller headers override
    const headers: Record<string, string> = {};
    if (req.json) {
      Object.assign(headers, DEFAULT_JSON_HEADERS);
    }
    Object.assign(headers, req.headers);

    // Build fetch options
    const options: RequestInit = {
      method: req.method,
      headers,
      signal: controller.signal,
    };

    if (req.json) {
      options.body = JSON.stringify(req.json);
    }

    // Perform request
    const response = await fetch(url, options);

    // Check for HTTP errors (non-2xx)
    if (!response.ok) {
      const bodySnippet = await extractBodySnippet(response);
      throw new HttpError({
        status: response.status,
        statusText: response.statusText,
        url,
        bodySnippet,
        headers: response.headers,
      });
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    // Check content-type before parsing JSON
    const contentType = response.headers.get("content-type");
    const isJson = contentType && (contentType.includes("application/json") || contentType.includes("+json"));

    if (!isJson) {
      logger.warn("Non-JSON response received", {
        method: req.method,
        url,
        status: response.status,
        contentType: contentType || "none",
      });
      // Return text content as fallback, let caller handle it
      const text = await response.text();
      return text as unknown as T;
    }

    // Parse JSON response with error handling
    try {
      const data = await response.json();
      return data as T;
    } catch (parseError) {
      logger.warn("JSON parse failed", {
        method: req.method,
        url,
        status: response.status,
        error: (parseError as Error).message,
      });
      // Return undefined for parse failures to avoid crashing the flow
      return undefined as T;
    }
  } catch (error) {
    // Re-throw HttpError as-is
    if (error instanceof HttpError) {
      throw error;
    }

    // Preserve AbortError for retry detection - do NOT convert to generic Error
    if ((error as Error).name === "AbortError") {
      throw error;
    }

    // Handle other errors (network, parsing, etc.)
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Perform an HTTP request with timeout, retries, and error handling
 * 
 * Retries are only performed for idempotent methods (GET, HEAD) on:
 * - Network errors (no response received)
 * - Timeout errors
 * - HTTP 408 (Request Timeout)
 * - HTTP 429 (Too Many Requests) - respects Retry-After header
 * - HTTP 5xx (Server errors)
 * 
 * Uses exponential backoff with jitter to avoid thundering herd.
 * 
 * @template T - Expected response type
 * @param req - HTTP request configuration
 * @returns Parsed JSON response of type T
 * @throws {HttpError} On non-2xx status codes (after all retries exhausted)
 * @throws {Error} On network errors or timeouts (after all retries exhausted)
 */
export async function httpRequest<T>(req: HttpRequest): Promise<T> {
  const timeoutMs = req.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const url = buildUrl(req.url, req.query);

  // Retry configuration with defaults
  const maxAttempts = req.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = req.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = req.retry?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const maxRetryAfterMs = req.retry?.maxRetryAfterMs ?? DEFAULT_MAX_RETRY_AFTER_MS;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await performRequest<T>(req, url, timeoutMs);
    } catch (error) {
      lastError = error;

      // Don't retry if this is the last attempt
      if (attempt >= maxAttempts) {
        break;
      }

      // Check if error is retryable
      if (!isErrorRetryable(error, req.method)) {
        throw error;
      }

      // Extract Retry-After header if available (429 or 503)
      let retryAfterHeader: string | null = null;
      if (error instanceof HttpError && error.headers) {
        if (error.status === 429 || error.status === 503) {
          retryAfterHeader = error.headers.get("retry-after");
        }
      }

      // Compute delay before next retry
      const delayMs = computeRetryDelay(
        attempt,
        baseDelayMs,
        maxDelayMs,
        maxRetryAfterMs,
        retryAfterHeader,
      );

      // Log retry attempt
      logger.debug("Retrying HTTP request", {
        method: req.method,
        url: req.url,
        attempt,
        maxAttempts,
        delayMs,
        reason: error instanceof HttpError ? `status ${error.status}` : (error as Error).name,
      });

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // All retries exhausted, throw the last error
  throw lastError;
}
