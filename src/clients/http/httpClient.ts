/**
 * HTTP client wrapper — general-purpose JSON client using native fetch
 * Supports timeouts, query params, and structured error handling
 */

import type { HttpRequest } from "@/types/clients/http";
import { HttpError } from "@/types/clients/http";
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_JSON_HEADERS,
  ERROR_BODY_SNIPPET_MAX_LENGTH,
} from "@/constants/clients/http";

/**
 * Build URL with query parameters
 */
function buildUrl(baseUrl: string, query?: Record<string, string | number | boolean>): string {
  if (!query || Object.keys(query).length === 0) {
    return baseUrl;
  }

  const url = new URL(baseUrl);
  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.append(key, String(value));
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
 * Perform an HTTP request with timeout and error handling
 * 
 * @template T - Expected response type
 * @param req - HTTP request configuration
 * @returns Parsed JSON response of type T
 * @throws {HttpError} On non-2xx status codes
 * @throws {Error} On network errors or timeouts
 */
export async function httpRequest<T>(req: HttpRequest): Promise<T> {
  const timeoutMs = req.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const url = buildUrl(req.url, req.query);

  // Setup timeout using AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Build headers
    const headers: Record<string, string> = { ...req.headers };
    if (req.json) {
      Object.assign(headers, DEFAULT_JSON_HEADERS);
    }

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
      });
    }

    // Parse JSON response
    const data = await response.json();
    return data as T;
  } catch (error) {
    // Re-throw HttpError as-is
    if (error instanceof HttpError) {
      throw error;
    }

    // Handle abort (timeout)
    if ((error as Error).name === "AbortError") {
      throw new Error(`HTTP request timeout after ${timeoutMs}ms: ${url}`);
    }

    // Handle other errors (network, parsing, etc.)
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
