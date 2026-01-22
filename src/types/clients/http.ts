/**
 * HTTP client type definitions
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  json?: unknown;
  timeoutMs?: number;
}

export interface HttpErrorDetails {
  status: number;
  statusText: string;
  url: string;
  bodySnippet?: string;
}

export class HttpError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;
  public readonly bodySnippet?: string;

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

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError);
    }
  }
}
