/**
 * Mock HTTP Harness for E2E Offline Tests
 *
 * Provides a controllable HTTP mock that:
 * - Returns fixture JSON for registered routes
 * - Throws loudly on unmocked requests (prevents accidental real calls)
 * - Supports basic method+url matching
 *
 * Usage:
 *   const mock = createMockHttp();
 *   mock.on("GET", "https://api.infojobs.net/api/9/offer", fixtureData);
 *   const client = new InfoJobsClient(mock.request);
 */

import type { HttpRequest } from "@/types";
import { HttpError } from "@/clients/http";
import { readFileSync } from "fs";
import { join } from "path";

type RouteKey = string; // "METHOD URL"
type RouteHandler = (req: HttpRequest) => Promise<unknown>;

type MockHttpHeaders = Record<string, string>;

type MockHttpReply = {
  __mockHttpReply: true;
  status: number;
  body: unknown;
  headers?: MockHttpHeaders;
};

function asReply(input: {
  status: number;
  body: unknown;
  headers?: MockHttpHeaders;
}): MockHttpReply {
  return {
    __mockHttpReply: true,
    status: input.status,
    body: input.body,
    headers: input.headers,
  };
}

function isReply(value: unknown): value is MockHttpReply {
  return (
    typeof value === "object" &&
    value !== null &&
    "__mockHttpReply" in value &&
    (value as { __mockHttpReply?: unknown }).__mockHttpReply === true
  );
}

/**
 * Mock HTTP client for testing
 */
export interface MockHttp {
  /**
   * Register a mock response for a given method+url
   * @param method - HTTP method (GET, POST, etc.)
   * @param url - Full URL or URL pattern
   * @param response - Response data (will be returned as-is)
   */
  on(method: string, url: string, response: unknown): void;

  /**
   * Register a mock response with explicit status/body/headers
   * @param method - HTTP method (GET, POST, etc.)
   * @param url - Full URL or URL pattern
   * @param response - Structured response
   */
  onResponse(
    method: string,
    url: string,
    response: {
      status: number;
      body: unknown;
      headers?: MockHttpHeaders;
    },
  ): void;

  /**
   * Register a custom handler for a given method+url
   * @param method - HTTP method
   * @param url - Full URL or URL pattern
   * @param handler - Custom handler function
   */
  onCustom(method: string, url: string, handler: RouteHandler): void;

  /**
   * Mock httpRequest function (inject into clients)
   */
  request: <T>(req: HttpRequest) => Promise<T>;

  /**
   * Get recorded requests (for debugging/assertions)
   */
  getRecordedRequests(): HttpRequest[];

  /**
   * Clear all mocks and recorded requests
   */
  reset(): void;
}

/**
 * Load fixture content from tests/fixtures as UTF-8 text
 *
 * @param relativePath - Path relative to tests/fixtures (e.g. "ats/lever/list.json")
 * @returns Raw fixture file content as string
 */
export function loadFixtureText(relativePath: string): string {
  const fullPath = join(process.cwd(), "tests", "fixtures", relativePath);
  return readFileSync(fullPath, "utf-8");
}

/**
 * Build route key from method and URL (ignores query params)
 */
function buildRouteKey(method: string, url: string): RouteKey {
  // Strip query params from URL for matching
  const urlWithoutQuery = url.split("?")[0];
  return `${method.toUpperCase()} ${urlWithoutQuery}`;
}

/**
 * Create a mock HTTP client
 */
export function createMockHttp(): MockHttp {
  const routes = new Map<RouteKey, RouteHandler>();
  const recordedRequests: HttpRequest[] = [];

  const on = (method: string, url: string, response: unknown): void => {
    const key = buildRouteKey(method, url);
    routes.set(key, async () =>
      asReply({
        status: 200,
        body: response,
      }),
    );
  };

  const onResponse = (
    method: string,
    url: string,
    response: {
      status: number;
      body: unknown;
      headers?: MockHttpHeaders;
    },
  ): void => {
    const key = buildRouteKey(method, url);
    routes.set(key, async () => asReply(response));
  };

  const onCustom = (
    method: string,
    url: string,
    handler: RouteHandler,
  ): void => {
    const key = buildRouteKey(method, url);
    routes.set(key, handler);
  };

  const request = async <T>(req: HttpRequest): Promise<T> => {
    // Record the request
    recordedRequests.push({ ...req });

    // Match route
    const key = buildRouteKey(req.method, req.url);
    const handler = routes.get(key);

    if (!handler) {
      throw new Error(
        `[MockHttp] Unmocked request: ${key}\n` +
          `This is likely a bug in the test setup. ` +
          `All HTTP requests must be explicitly mocked to prevent accidental network calls.\n` +
          `Available routes: ${Array.from(routes.keys()).join(", ") || "(none)"}`,
      );
    }

    // Execute handler
    const response = await handler(req);

    if (!isReply(response)) {
      // Backward-compatible default for custom handlers
      return response as T;
    }

    if (response.status >= 200 && response.status < 300) {
      return response.body as T;
    }

    const bodySnippet =
      typeof response.body === "string"
        ? response.body
        : JSON.stringify(response.body);

    throw new HttpError({
      status: response.status,
      statusText: "Mock Response",
      url: req.url,
      bodySnippet,
      headers: response.headers ? new Headers(response.headers) : undefined,
    });
  };

  const getRecordedRequests = (): HttpRequest[] => {
    return [...recordedRequests];
  };

  const reset = (): void => {
    routes.clear();
    recordedRequests.length = 0;
  };

  return {
    on,
    onResponse,
    onCustom,
    request,
    getRecordedRequests,
    reset,
  };
}
