import { describe, it } from "node:test";
import assert from "node:assert";
import { computeThroughputScore } from "./compute-throughput-score";
import type { RequestMetric } from "../request-metric";

function mockMetric(overrides: Partial<RequestMetric>): RequestMetric {
  return {
    requestId: "id",
    provider: "p",
    model: "m",
    timestamp: Date.now(),
    ttft: 200,
    totalLatency: 1200,
    inputTokens: 500,
    outputTokens: 100,
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

await describe("computeThroughputScore", async () => {
  await it("returns default for empty metrics", () => {
    const score = computeThroughputScore([], false);
    assert.ok(score > 0);
  });

  await it("scores 100 for TPS above target", () => {
    // 200 tokens in 1 second = 200 TPS > 80 target
    const metrics = [
      mockMetric({ outputTokens: 200, ttft: 200, totalLatency: 1200 }),
    ];
    const score = computeThroughputScore(metrics, false);
    assert.strictEqual(score, 100);
  });

  await it("handles non-streaming calls (ttft ≈ totalLatency)", () => {
    // 100 tokens in 2 seconds = 50 TPS
    const metrics = [
      mockMetric({ outputTokens: 100, ttft: 2000, totalLatency: 2000 }),
    ];
    const score = computeThroughputScore(metrics, false);
    // 50/80 * 100 = 62.5
    assert.ok(Math.abs(score - 62.5) < 0.01, `score ${String(score)} ≈ 62.5`);
  });

  await it("uses reasoning target TPS when isReasoning=true", () => {
    // 30 TPS with reasoning target of 25 → 100 (capped)
    const metrics = [
      mockMetric({ outputTokens: 60, ttft: 500, totalLatency: 2500 }),
    ];
    // streaming time = 2000ms = 2s, TPS = 60/2 = 30
    const score = computeThroughputScore(metrics, true);
    assert.strictEqual(score, 100);
  });
});
