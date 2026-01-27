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

type RouteKey = string; // "METHOD URL"
type RouteHandler = (req: HttpRequest) => Promise<unknown>;

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
    routes.set(key, async () => response);
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
    return response as T;
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
    onCustom,
    request,
    getRecordedRequests,
    reset,
  };
}
