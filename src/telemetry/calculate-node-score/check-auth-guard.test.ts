import assert from "node:assert";
import { describe, it } from "node:test";
import type { RequestMetric } from "../request-metric";
import { checkAuthGuard } from "./check-auth-guard";

function mockMetric(overrides: Partial<RequestMetric>): RequestMetric {
  return {
    requestId: "id",
    provider: "p",
    model: "m",
    timestamp: Date.now(),
    ttft: 100,
    totalLatency: 500,
    inputTokens: 300,
    outputTokens: 50,
    thinkingTime: null,
    finishReason: "stop",
    refused: false,
    statusCode: 200,
    errorType: null,
    success: true,
    source: "user",
    ...overrides,
  };
}

await describe("checkAuthGuard", async () => {
  await it("returns passed for empty metrics", () => {
    const result = checkAuthGuard([]);
    assert.strictEqual(result.passed, true);
  });

  await it("returns score 0 for two consecutive auth errors", () => {
    const now = Date.now();
    const metrics = [
      mockMetric({
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        timestamp: now,
      }),
      mockMetric({
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        timestamp: now - 1000,
      }),
    ];
    const result = checkAuthGuard(metrics);
    assert.deepStrictEqual(result, { passed: false, score: 0 });
  });

  await it("returns passed for auth errors with a success in between", () => {
    const now = Date.now();
    const metrics = [
      mockMetric({
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        timestamp: now,
      }),
      mockMetric({ success: true, timestamp: now - 1000 }),
      mockMetric({
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        timestamp: now - 2000,
      }),
    ];
    const result = checkAuthGuard(metrics);
    assert.strictEqual(result.passed, true);
  });

  await it("returns score 0 when all requests fail", () => {
    const now = Date.now();
    const metrics = [
      mockMetric({
        success: false,
        statusCode: 500,
        errorType: "server-error",
        timestamp: now,
      }),
      mockMetric({
        success: false,
        statusCode: 500,
        errorType: "server-error",
        timestamp: now - 1000,
      }),
    ];
    const result = checkAuthGuard(metrics);
    assert.strictEqual(result.passed, false);
  });

  await it("returns passed for isolated auth error followed by success", () => {
    const now = Date.now();
    const metrics = [
      mockMetric({ success: true, timestamp: now }),
      mockMetric({
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        timestamp: now - 5000,
      }),
    ];
    const result = checkAuthGuard(metrics);
    assert.strictEqual(result.passed, true);
  });

  await it("does not count non-auth errors in consecutive auth chain", () => {
    const now = Date.now();
    const metrics = [
      mockMetric({
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        timestamp: now,
      }),
      mockMetric({
        success: false,
        statusCode: 429,
        errorType: "rate-limited",
        timestamp: now - 1000,
      }),
      mockMetric({
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        timestamp: now - 2000,
      }),
      // success at end avoids totalErrors === totalRequests early exit
      mockMetric({
        success: true,
        statusCode: 200,
        timestamp: now - 3000,
      }),
    ];
    const result = checkAuthGuard(metrics);
    assert.strictEqual(result.passed, true);
  });
});
