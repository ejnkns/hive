import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { selectBestNode } from "./node-selector";
import { sessionTracker } from "./session-tracker";
import { circuitBreaker } from "./circuit-breaker";
import { empiricalDisabledFeatures } from "./feature-discovery";
import type { RequestMetric } from "../telemetry/request-metric";

function createMockMetric(overrides: Partial<RequestMetric>): RequestMetric {
  return {
    requestId: "req-1",
    provider: "prov",
    model: "mod",
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

describe("Hive Routing Engine Verification", () => {
  beforeEach(() => {
    circuitBreaker.clear();
    empiricalDisabledFeatures.clear();
    sessionTracker.sessions.clear();
    process.env.HIVE_ROUTING_STRATEGY = "balanced";
    process.env.HIVE_MIN_TOKEN_TELEMETRY = "200";
  });

  it("should isolate session affinity across independent concurrent session IDs", () => {
    const nodes = [
      { providerName: "p1", modelName: "m1" },
      { providerName: "p2", modelName: "m2" },
    ];

    const getMetrics = () => [createMockMetric({})];

    sessionTracker.sessions.set("user-session-alpha", "p1:m1");
    sessionTracker.sessions.set("user-session-beta", "p2:m2");

    const matchAlpha = selectBestNode(
      nodes,
      getMetrics,
      [],
      "user-session-alpha"
    );
    const matchBeta = selectBestNode(
      nodes,
      getMetrics,
      [],
      "user-session-beta"
    );

    assert.strictEqual(matchAlpha?.providerName, "p1");
    assert.strictEqual(matchBeta?.providerName, "p2");
  });

  it("should apply relative gradient probabilities rather than flat absolute scores", () => {
    const nodes = [
      { providerName: "high-tier", modelName: "best" },
      { providerName: "low-tier", modelName: "worst" },
    ];

    const getMetrics = (key: string) => {
      if (key === "high-tier:best") {
        return [createMockMetric({ ttft: 50, totalLatency: 200 })];
      }
      return [createMockMetric({ ttft: 400, totalLatency: 1500 })];
    };

    let highTierSelections = 0;
    for (let i = 0; i < 100; i++) {
      const selected = selectBestNode(nodes, getMetrics, []);
      if (selected?.providerName === "high-tier") highTierSelections++;
    }

    assert.ok(
      highTierSelections > 75,
      `Expected dominant selection curve. Got: ${highTierSelections}/100`
    );
  });
});
