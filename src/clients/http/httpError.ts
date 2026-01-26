/**
 * HttpError class — structured error for HTTP failures
 *
 * Separated from types (which should be shapes only) per project-layout.md conventions.
 */

import type { HttpErrorDetails } from "@/types";

/**
 * Structured error class for HTTP failures
 * Contains status, URL, and optional response body snippet for debugging
 */
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
