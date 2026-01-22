/**
 * HTTP client type definitions
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

/**
 * Retry configuration for HTTP requests
 */
export interface HttpRetryConfig {
  /** Maximum number of attempts (including initial request). Default from constants. */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default from constants. */
  baseDelayMs?: number;
  /** Maximum delay in ms between retries. Default from constants. */
  maxDelayMs?: number;
  /** Maximum time in ms to wait for Retry-After header. Default from constants. */
  maxRetryAfterMs?: number;
}

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | Array<string | number | boolean>>;
  json?: unknown;
  timeoutMs?: number;
  retry?: HttpRetryConfig;
}

export interface HttpErrorDetails {
  status: number;
  statusText: string;
  url: string;
  bodySnippet?: string;
  headers?: Headers;
}

export class HttpError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;
  public readonly bodySnippet?: string;
  public readonly headers?: Headers;

  constructor(details: HttpErrorDetails) {
    super(
      `HTTP ${details.status} ${details.statusText} - ${details.url}${
        details.bodySnippet ? ` - ${details.bodySnippet}` : ""
      }`,
    );
    this.name = "HttpError";
    this.status = details.status;
    this.statusText = details.statusText;
    this.url = details.url;
    this.bodySnippet = details.bodySnippet;
    this.headers = details.headers;

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError);
    }
  }
}
