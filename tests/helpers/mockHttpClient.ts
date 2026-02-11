/**
 * Backward-compatible test helper entrypoint for HTTP mocking.
 *
 * Re-exports the shared mock HTTP utilities used across offline tests.
 */

export { createMockHttp, loadFixtureText } from "./mockHttp";
export type { MockHttp } from "./mockHttp";
