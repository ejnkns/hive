import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { selectBestNode } from "./node-selector";
import { routingMemory } from "./routing-memory";
import type { RequestMetric } from "../telemetry";

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

await describe("Hive Routing Engine Verification", async () => {
  beforeEach(() => {
    routingMemory.reset();
    process.env.HIVE_ROUTING_STRATEGY = "balanced";
    process.env.HIVE_MIN_TOKEN_TELEMETRY = "200";
  });

  await it("should isolate session affinity across independent concurrent session IDs", () => {
    const nodes = [
      { providerName: "p1", modelName: "m1" },
      { providerName: "p2", modelName: "m2" },
    ];

    const getMetrics = () => [createMockMetric({})];

    routingMemory.setNodeAffinity("user-session-alpha", "p1:m1");
    routingMemory.setNodeAffinity("user-session-beta", "p2:m2");

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

  await it("should apply relative gradient probabilities rather than flat absolute scores", () => {
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
      `Expected dominant selection curve. Got: ${String(highTierSelections)}/100`
    );
  });

  await it("should evict oldest session when exceeding max entries", () => {
    for (let i = 0; i <= 1000; i++) {
      routingMemory.setNodeAffinity(
        `session-${String(i)}`,
        `node-${String(i)}`
      );
    }
    assert.strictEqual(
      routingMemory.getNodeAffinity("session-0"),
      undefined,
      "Oldest session should be evicted after exceeding max 1000 entries"
    );
    assert.ok(
      routingMemory.getNodeAffinity("session-1000"),
      "Newest session should still be present"
    );
  });

  await it("should maintain affinity for a session across multiple selections", () => {
    const nodes = [
      { providerName: "p1", modelName: "m1" },
      { providerName: "p2", modelName: "m2" },
    ];
    const getMetrics = () => [createMockMetric({})];
    const sessionId = "persistent-session";

    const first = selectBestNode(nodes, getMetrics, [], sessionId);
    if (!first) throw new Error("Expected a node to be selected");
    const firstKey = `${first.providerName}:${first.modelName}`;

    for (let i = 0; i < 10; i++) {
      const selected = selectBestNode(nodes, getMetrics, [], sessionId);
      if (!selected) throw new Error("Expected a node to be selected");
      assert.strictEqual(
        `${selected.providerName}:${selected.modelName}`,
        firstKey,
        "Session affinity should persist across multiple selections"
      );
    }
  });
});
