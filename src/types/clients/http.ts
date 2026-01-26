/**
 * HTTP client type definitions
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/**
 * Retry configuration for HTTP requests
 */
export type HttpRetryConfig = {
  /** Maximum number of attempts (including initial request). Default from constants. */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default from constants. */
  baseDelayMs?: number;
  /** Maximum delay in ms between retries. Default from constants. */
  maxDelayMs?: number;
  /** Maximum time in ms to wait for Retry-After header. Default from constants. */
  maxRetryAfterMs?: number;
};

export type HttpRequest = {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<
    string,
    string | number | boolean | Array<string | number | boolean>
  >;
  json?: unknown;
  timeoutMs?: number;
  retry?: HttpRetryConfig;
};

export type HttpErrorDetails = {
  status: number;
  statusText: string;
  url: string;
  bodySnippet?: string;
  headers?: Headers;
};
