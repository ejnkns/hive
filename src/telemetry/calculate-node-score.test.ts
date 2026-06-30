import assert from "node:assert";
import { describe, it } from "node:test";
import { calculateNodeScore, type Node } from "./calculate-node-score";
import type { RequestMetric } from "./request-metric";

function mockMetric(overrides: Partial<RequestMetric>): RequestMetric {
  return {
    requestId: "id-123",
    provider: "test-p",
    model: "test-m",
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

await describe("Hive Scoring Suite", async () => {
  const node: Node = {
    providerName: "together",
    modelName: "llama-3-70b",
  };

  await it("should enforce continuous context boundaries and omit small probe traffic from latency scores", () => {
    const history = [
      mockMetric({ ttft: 4000, totalLatency: 9000, inputTokens: 50 }),
      mockMetric({ ttft: 150, totalLatency: 650, inputTokens: 400 }),
    ];

    const score = calculateNodeScore(node, history, "latency", 200).composite;
    assert.ok(score > 70, `Expected clean velocity scaling score, received: ${String(score)}`);
  });

  await it("should grant flexible, protective scaling options to reasoning models experiencing high thinking time", () => {
    const reasoningNode: Node = {
      providerName: "groq",
      modelName: "deepseek-r1",
    };
    const history = [
      mockMetric({
        ttft: 4500,
        totalLatency: 12000,
        inputTokens: 600,
        outputTokens: 300,
      }),
    ];

    const score = calculateNodeScore(reasoningNode, history, "balanced", 200).composite;
    assert.ok(score > 50, `Reasoning models should possess extended operational score lanes. Got: ${String(score)}`);
  });

  await it("should close the authentication loophole by dropping dead or unauthenticated paths to zero", () => {
    const now = Date.now();
    const history = [
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
      mockMetric({ success: true, source: "heartbeat", timestamp: now - 2000 }),
    ];

    const result = calculateNodeScore(node, history, "balanced", 200);
    assert.strictEqual(result.composite, 0, "Consecutive auth failures must drop node ranking to zero.");
    assert.deepStrictEqual(
      result.subscores,
      {
        latency: 0,
        throughput: 0,
        reliability: 0,
        quality: 0,
        contextWindow: 0,
      },
      "Auth guard must zero all subscores."
    );
  });

  await it("should penalize structural anomalies like context length truncation drops inside the quality score", () => {
    const history = [
      mockMetric({ finishReason: "length" }),
      mockMetric({ finishReason: "length" }),
      mockMetric({ finishReason: "stop" }),
    ];

    const standardScore = calculateNodeScore(node, [mockMetric({ finishReason: "stop" })], "quality", 200).composite;
    const damagedScore = calculateNodeScore(node, history, "quality", 200).composite;

    assert.ok(damagedScore < standardScore, "High context window truncations must degrade quality metric parameters.");
  });

  await it("returns non-zero subscores for clean metrics", () => {
    const metrics = [mockMetric({ ttft: 100, outputTokens: 100 })];
    const result = calculateNodeScore(node, metrics, "balanced", 200);
    assert.ok(result.subscores.latency > 0, "latency subscore should be positive");
    assert.ok(result.subscores.throughput > 0, "throughput subscore should be positive");
    assert.ok(result.subscores.reliability > 0, "reliability subscore should be positive");
    assert.ok(result.subscores.quality > 0, "quality subscore should be positive");
  });

  await it("returns contextWindow subscore when maxContextTokens is set", () => {
    const metrics = [mockMetric({})];
    const nodeWithCtx: Node = {
      providerName: "p",
      modelName: "m",
      maxContextTokens: 128_000,
    };
    const result = calculateNodeScore(nodeWithCtx, metrics, "balanced", 200);
    assert.strictEqual(result.subscores.contextWindow, 100, "128K context should score 100");
  });

  await it("returns zero contextWindow subscore when maxContextTokens is absent", () => {
    const metrics = [mockMetric({})];
    const result = calculateNodeScore(node, metrics, "balanced", 200);
    assert.strictEqual(result.subscores.contextWindow, 0, "no context tokens should score 0");
  });
});

await describe("Telemetry Optimization Extensions", async () => {
  const testNode = { providerName: "provider-a", modelName: "model-a" };

  await it("should accurately track throughput metrics for non-streaming calls", () => {
    const metrics: RequestMetric[] = [
      {
        requestId: "ns-1",
        provider: "provider-a",
        model: "model-a",
        timestamp: Date.now(),
        ttft: 500,
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
      },
    ];

    const score = calculateNodeScore(testNode, metrics, "balanced", 200).composite;
    assert.ok(score > 0, "Non-streaming transactions must contribute to throughput scores.");
  });

  await it("should survive an isolated authentication failure if subsequent connections succeed", () => {
    const now = Date.now();
    const metrics: RequestMetric[] = [
      {
        requestId: "r1",
        provider: "provider-a",
        model: "model-a",
        timestamp: now,
        success: true,
        statusCode: 200,
        source: "user",
        inputTokens: 400,
        outputTokens: 50,
        ttft: 100,
        totalLatency: 400,
        thinkingTime: null,
        finishReason: "stop",
        refused: false,
        toolCallFailed: false,
        errorType: null,
      },
      {
        requestId: "r0",
        provider: "provider-a",
        model: "model-a",
        timestamp: now - 5000,
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        source: "user",
        inputTokens: null,
        outputTokens: null,
        ttft: 100,
        totalLatency: 100,
        thinkingTime: null,
        finishReason: null,
        refused: false,
        toolCallFailed: false,
      },
    ];

    const score = calculateNodeScore(testNode, metrics, "balanced", 200).composite;
    assert.ok(score > 0, "Transient authorization adjustments must not disable the pathway permanently.");
  });

  await it("should penalize 401s significantly more than 429s", () => {
    const now = Date.now();
    const baseSuccess = mockMetric({ timestamp: now - 60000 });
    const metrics429 = [
      baseSuccess,
      mockMetric({
        success: false,
        statusCode: 429,
        errorType: "rate-limited",
        timestamp: now,
      }),
    ];
    const metrics401 = [
      baseSuccess,
      mockMetric({
        success: false,
        statusCode: 401,
        errorType: "auth-error",
        timestamp: now,
      }),
    ];

    const score429 = calculateNodeScore(testNode, metrics429, "balanced", 200).composite;
    const score401 = calculateNodeScore(testNode, metrics401, "balanced", 200).composite;

    assert.ok(
      score401 < score429,
      `Hard errors (401) should reduce score more than soft errors (429). 401: ${String(score401)}, 429: ${String(score429)}`
    );
  });
});

await describe("Severity-Weighted Temporal Decay", async () => {
  const testNode = { providerName: "provider-a", modelName: "model-a" };
  const now = Date.now();

  await it("should gradually recover as successful requests accumulate after a failure", () => {
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

    const earlyScore = calculateNodeScore(testNode, earlyRecovery, "balanced", 200).composite;
    const midScore = calculateNodeScore(testNode, midRecovery, "balanced", 200).composite;
    const fullScore = calculateNodeScore(testNode, fullRecovery, "balanced", 200).composite;

    assert.ok(
      earlyScore < midScore,
      `Score should climb with early recoveries. Early: ${String(earlyScore)}, Mid: ${String(midScore)}`
    );
    assert.ok(
      midScore < fullScore,
      `Score should climb further with more recoveries. Mid: ${String(midScore)}, Full: ${String(fullScore)}`
    );
    assert.ok(fullScore > 80, `Score should approach 100 with enough successful requests. Full: ${String(fullScore)}`);
  });

  await it("should degrade score more for burst failures than spread failures", () => {
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
          timestamp: now - i * (6 * 60 * 1000),
        })
      ),
    ];

    const burstScore = calculateNodeScore(testNode, burstFailures, "balanced", 200).composite;
    const spreadScore = calculateNodeScore(testNode, spreadFailures, "balanced", 200).composite;

    assert.ok(
      burstScore < spreadScore,
      `Burst failures should degrade score more than spread failures. Burst: ${String(burstScore)}, Spread: ${String(spreadScore)}`
    );
  });

  await it("should return 0 instantly for two consecutive 401s, bypassing exponential math", () => {
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
      mockMetric({ success: true, source: "heartbeat", timestamp: now - 2000 }),
    ];

    const score = calculateNodeScore(testNode, metrics, "balanced", 200).composite;
    assert.strictEqual(score, 0, "Two consecutive 401s must return 0 instantly via hard guard.");
  });
});
