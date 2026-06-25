import { describe, it } from "node:test";
import assert from "node:assert";
import { calculateScore } from "./score";
import type { RequestMetric } from "./request-metric";

// Helper to generate mock metrics
function createMockMetric(overrides: Partial<RequestMetric>): RequestMetric {
  return {
    requestId: "test-id",
    provider: "test-provider",
    model: "test-model",
    timestamp: Date.now(),
    ttft: 500,
    totalLatency: 2000,
    inputTokens: 50,
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

describe("Telemetry Scoring Logic", () => {
  describe("Reasoning Model Bias", () => {
    it("should not penalize reasoning models with zero scores for expected TTFTs", () => {
      // Simulating a typical DeepSeek-R1 or o1 response
      const metrics = [
        createMockMetric({
          ttft: 8000, // 8 seconds TTFT
          thinkingTime: 12000, // 12 seconds thinking
          outputTokens: 500,
          totalLatency: 25000,
        }),
      ];

      const score = calculateScore(metrics);
      // Currently, this will fail because TTFT > 5000ms yields a 0 score,
      // and Thinking > 10000ms yields a 0 score.
      // A highly capable model doing its job shouldn't score an abysmal grade.
      assert.ok(
        score > 50,
        `Expected reasonable score for deep thinking, got ${score}`
      );
    });
  });

  describe("Throughput Bias", () => {
    it("should grant competitive scores to capable models with standard TPS", () => {
      // Simulating a highly capable 70B model streaming at 40 TPS
      const metrics = [
        createMockMetric({
          ttft: 800,
          totalLatency: 3300,
          outputTokens: 100, // 100 tokens in 2.5s = 40 TPS
        }),
      ];

      const score = calculateScore(metrics);
      // Currently, 40 TPS / 2 = 20/100 for the throughput sub-score.
      assert.ok(score > 70, `Expected solid score for 40 TPS, got ${score}`);
    });
  });

  describe("Authentication Loophole", () => {
    it("should severely penalize a provider returning 100% auth errors", () => {
      const metrics = [
        createMockMetric({
          success: false,
          statusCode: 401,
          errorType: "auth-error",
          ttft: 100,
          outputTokens: null,
        }),
      ];

      const score = calculateScore(metrics);
      // Currently, auth-error penalty is 0.0, leading to a near-perfect reliability score.
      assert.ok(
        score < 50,
        `Expected failing score for auth errors, got ${score}`
      );
    });
  });

  describe("Heartbeat Data Skew", () => {
    it("should isolate user request performance from heartbeat pings", () => {
      const userMetrics = [
        createMockMetric({
          ttft: 2000,
          totalLatency: 5000,
          outputTokens: 100,
          source: "user",
        }),
      ];

      const combinedMetrics = [
        ...userMetrics,
        // Heartbeats resolve instantly with 1 token
        createMockMetric({
          ttft: 150,
          totalLatency: 200,
          outputTokens: 1,
          source: "heartbeat",
        }),
        createMockMetric({
          ttft: 150,
          totalLatency: 200,
          outputTokens: 1,
          source: "heartbeat",
        }),
        createMockMetric({
          ttft: 150,
          totalLatency: 200,
          outputTokens: 1,
          source: "heartbeat",
        }),
      ];

      const scoreWithUserOnly = calculateScore(userMetrics);
      const scoreWithHeartbeats = calculateScore(combinedMetrics);

      // Heartbeats should ideally be filtered out of the p95 TTFT and TPS math,
      // otherwise they mask poor user-facing performance.
      const difference = Math.abs(scoreWithUserOnly - scoreWithHeartbeats);
      assert.ok(
        difference < 5,
        `Heartbeats significantly skewed the score by ${difference} points`
      );
    });
  });
});
