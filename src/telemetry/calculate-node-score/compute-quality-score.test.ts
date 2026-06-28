import { describe, it } from "node:test";
import assert from "node:assert";
import { computeQualityScore } from "./compute-quality-score";
import type { RequestMetric } from "../request-metric";

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

await describe("computeQualityScore", async () => {
  await it("returns 100 for clean metrics", () => {
    const metrics = [mockMetric({}), mockMetric({})];
    assert.strictEqual(computeQualityScore(metrics), 100);
  });

  await it("penalizes refusals", () => {
    const metrics = [mockMetric({ refused: true }), mockMetric({})];
    const score = computeQualityScore(metrics);
    assert.strictEqual(score, 50);
  });

  await it("penalizes truncations", () => {
    const metrics = [mockMetric({ finishReason: "length" }), mockMetric({})];
    const score = computeQualityScore(metrics);
    assert.strictEqual(score, 50);
  });

  await it("returns 0 when all metrics are faults", () => {
    const metrics = [
      mockMetric({ refused: true }),
      mockMetric({ finishReason: "length" }),
    ];
    assert.strictEqual(computeQualityScore(metrics), 0);
  });
});
