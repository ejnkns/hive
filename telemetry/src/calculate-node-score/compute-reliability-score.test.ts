import assert from "node:assert";
import { describe, it } from "node:test";
import type { RequestMetric } from "../request-metric";
import { computeReliabilityScore } from "./compute-reliability-score";

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
    toolCallFailed: false,
    ...overrides,
  };
}

await describe("computeReliabilityScore", async () => {
  await it("returns 100 for all-success metrics", () => {
    const metrics = [
      mockMetric({}),
      mockMetric({ timestamp: Date.now() - 60_000 }),
    ];
    const score = computeReliabilityScore(metrics);
    assert.strictEqual(score, 100);
  });

  await it("returns 0 for all-failure metrics", () => {
    const metrics = [
      mockMetric({
        success: false,
        statusCode: 500,
        errorType: "server-error",
      }),
    ];
    const score = computeReliabilityScore(metrics);
    assert.strictEqual(score, 0);
  });

  await it("recovers as successful requests accumulate after a failure", () => {
    const now = Date.now();
    const failure = mockMetric({
      success: false,
      statusCode: 429,
      errorType: "rate-limited",
      timestamp: now - 60_000,
    });

    const earlyRecovery = [failure, mockMetric({ timestamp: now - 50_000 })];
    const midRecovery = [
      failure,
      mockMetric({ timestamp: now - 50_000 }),
      mockMetric({ timestamp: now - 40_000 }),
      mockMetric({ timestamp: now - 30_000 }),
    ];
    const fullRecovery = [
      failure,
      mockMetric({ timestamp: now - 50_000 }),
      mockMetric({ timestamp: now - 40_000 }),
      mockMetric({ timestamp: now - 30_000 }),
      mockMetric({ timestamp: now - 20_000 }),
      mockMetric({ timestamp: now - 10_000 }),
      mockMetric({ timestamp: now }),
    ];

    const early = computeReliabilityScore(earlyRecovery);
    const mid = computeReliabilityScore(midRecovery);
    const full = computeReliabilityScore(fullRecovery);

    assert.ok(early < mid, `early ${String(early)} < mid ${String(mid)}`);
    assert.ok(mid < full, `mid ${String(mid)} < full ${String(full)}`);
    assert.ok(full > 80, `full ${String(full)} > 80`);
  });

  await it("penalizes burst failures more than spread failures", () => {
    const now = Date.now();
    const success = mockMetric({ timestamp: now - 120_000 });

    const burstFailures = [
      success,
      ...Array.from({ length: 5 }, (_, i) =>
        mockMetric({
          success: false,
          statusCode: 429,
          errorType: "rate-limited",
          timestamp: now - i * 200,
        })
      ),
    ];
    const spreadFailures = [
      success,
      ...Array.from({ length: 5 }, (_, i) =>
        mockMetric({
          success: false,
          statusCode: 429,
          errorType: "rate-limited",
          timestamp: now - i * 360_000,
        })
      ),
    ];

    const burst = computeReliabilityScore(burstFailures);
    const spread = computeReliabilityScore(spreadFailures);

    assert.ok(
      burst < spread,
      `burst ${String(burst)} < spread ${String(spread)}`
    );
  });

  await it("penalizes auth errors more than rate limits", () => {
    const now = Date.now();
    const base = mockMetric({ timestamp: now - 60_000 });

    const rateLimited = [
      base,
      mockMetric({
        success: false,
        statusCode: 429,
        errorType: "rate-limited",
        timestamp: now,
      }),
    ];
    const authError = [
      base,
      mockMetric({
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        timestamp: now,
      }),
    ];

    const rateScore = computeReliabilityScore(rateLimited);
    const authScore = computeReliabilityScore(authError);

    assert.ok(
      authScore < rateScore,
      `auth ${String(authScore)} < rate ${String(rateScore)}`
    );
  });
});
