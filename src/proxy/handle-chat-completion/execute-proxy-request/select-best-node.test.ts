import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import type { RequestMetric } from "../../../telemetry";
import { routingMemory } from "../../routing-memory";
import { selectBestNode } from "./select-best-node";

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
    toolCallFailed: false,
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

  await it("should return null for empty nodes array", () => {
    const result = selectBestNode([], () => [createMockMetric({})]);
    assert.strictEqual(result, null);
  });

  await it("should return null when all nodes are ineligible via circuit breaker", () => {
    const nodes = [{ providerName: "p1", modelName: "m1" }];
    routingMemory.recordUpstreamError("p1:m1", "rate-limit", []);
    const result = selectBestNode(nodes, () => [createMockMetric({})]);
    assert.strictEqual(result, null);
  });

  await it("should return null when no node supports required features", () => {
    const nodes = [{ providerName: "p1", modelName: "m1" }];
    routingMemory.recordUpstreamError("p1:m1", "unsupported-feature", [
      "tools",
    ]);
    const result = selectBestNode(nodes, () => [createMockMetric({})], [
      "tools",
    ]);
    assert.strictEqual(result, null);
  });

  await it("should select the only eligible node", () => {
    const node = { providerName: "only", modelName: "node" };
    for (let i = 0; i < 10; i++) {
      const result = selectBestNode([node], () => [createMockMetric({})], []);
      assert.notStrictEqual(result, null);
      assert.strictEqual(result?.providerName, "only");
    }
  });

  await it("should exclude nodes far below the top score from the qualified pool", () => {
    const nodes = [
      { providerName: "good", modelName: "best" },
      { providerName: "mid", modelName: "ok" },
      { providerName: "bad", modelName: "worst" },
    ];
    const getMetrics = (key: string) => {
      if (key === "good:best")
        return [createMockMetric({ ttft: 50, totalLatency: 500 })];
      if (key === "mid:ok")
        return [createMockMetric({ ttft: 200, totalLatency: 800 })];
      return [createMockMetric({ ttft: 400, totalLatency: 1500 })];
    };
    let badCount = 0;
    for (let i = 0; i < 100; i++) {
      const selected = selectBestNode(nodes, getMetrics, []);
      if (selected?.providerName === "bad") badCount++;
    }
    assert.strictEqual(
      badCount,
      0,
      "Node ~19 points below max must never enter the qualified pool"
    );
  });

  await it("should still select a node when all scores are zero", () => {
    const now = Date.now();
    const zeroMetrics = () => [
      createMockMetric({
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        timestamp: now,
      }),
      createMockMetric({
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        timestamp: now - 1000,
      }),
    ];
    const nodes = [
      { providerName: "p1", modelName: "m1" },
      { providerName: "p2", modelName: "m2" },
    ];
    const result = selectBestNode(nodes, zeroMetrics, []);
    assert.notStrictEqual(result, null);
    assert.ok(result?.providerName === "p1" || result?.providerName === "p2");
  });

  await it("should skip affinity boost when the affinity target is not in the node list", () => {
    routingMemory.setNodeAffinity("stale-session", "ghost:node");
    for (let i = 0; i < 10; i++) {
      const result = selectBestNode(
        [{ providerName: "real", modelName: "node" }],
        () => [createMockMetric({})],
        [],
        "stale-session"
      );
      assert.notStrictEqual(result, null);
      assert.strictEqual(result?.providerName, "real");
    }
  });

  await it("should apply session affinity boost to the matching node, increasing its selection probability", () => {
    routingMemory.setNodeAffinity("sticky-session", "p1:m1");
    const nodes = [
      { providerName: "p1", modelName: "m1" },
      { providerName: "p2", modelName: "m2" },
    ];
    const getMetrics = () => [createMockMetric({})];
    let p1Count = 0;
    for (let i = 0; i < 50; i++) {
      const selected = selectBestNode(nodes, getMetrics, [], "sticky-session");
      if (selected?.providerName === "p1") p1Count++;
    }
    assert.ok(
      p1Count > 25,
      `With equal base scores, the boosted node should be selected more often. Got: ${String(p1Count)}/50`
    );
  });

  await it("should skip affinity target when ineligible and select from remaining nodes", () => {
    routingMemory.setNodeAffinity("failing-session", "p1:m1");
    routingMemory.recordUpstreamError("p1:m1", "rate-limit", []);
    const nodes = [
      { providerName: "p1", modelName: "m1" },
      { providerName: "p2", modelName: "m2" },
    ];
    for (let i = 0; i < 10; i++) {
      const result = selectBestNode(
        nodes,
        () => [createMockMetric({})],
        [],
        "failing-session"
      );
      assert.notStrictEqual(result, null);
      assert.strictEqual(
        result?.providerName,
        "p2",
        "Must skip breaker-tripped affinity target"
      );
    }
  });
});
