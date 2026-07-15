import assert from "node:assert";
import { describe, it } from "node:test";
import type { RequestMetric } from "../request-metric";
import { computeLatencyScore } from "./compute-latency-score";

function mockMetric(overrides: Partial<RequestMetric>): RequestMetric {
  return {
    requestId: "id",
    provider: "p",
    model: "m",
    timestamp: Date.now(),
    ttft: 200,
    totalLatency: 1200,
    inputTokens: 500,
    outputTokens: 50,
    thinkingTime: null,
    finishReason: "stop",
    refused: false,
    statusCode: 200,
    errorType: null,
    success: true,
    source: "user",
    toolCallFailed: false,
    ...overrides,
  };
}

await describe("computeLatencyScore", async () => {
  await it("returns near 100 for very low latency", () => {
    const metrics = [mockMetric({ ttft: 10 })];
    const score = computeLatencyScore(metrics, false);
    assert.ok(score > 95, `score ${String(score)} > 95`);
  });

  await it("returns lower score for high latency", () => {
    const low = computeLatencyScore([mockMetric({ ttft: 50 })], false);
    const high = computeLatencyScore([mockMetric({ ttft: 3000 })], false);
    assert.ok(high < low, `high ${String(high)} < low ${String(low)}`);
  });

  await it("gives reasoning models more slack", () => {
    const metrics = [mockMetric({ ttft: 4500 })];
    const standard = computeLatencyScore(metrics, false);
    const reasoning = computeLatencyScore(metrics, true);
    assert.ok(
      reasoning > standard,
      `reasoning ${String(reasoning)} > standard ${String(standard)}`
    );
  });

  await it("uses p95 for multiple metrics", () => {
    const metrics = Array.from({ length: 20 }, (_, i) =>
      mockMetric({ ttft: i < 19 ? 100 : 5000 })
    );
    const score = computeLatencyScore(metrics, false);
    // p95 should be 5000, so score should be low
    assert.ok(score < 10, `score ${String(score)} < 10`);
  });
});
