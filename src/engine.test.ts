import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { PassThrough } from "node:stream";
import {
  HiveCore,
  selectBestNode,
  executeProxyRequest,
  circuitBreaker,
  empiricalDisabledFeatures,
  sessionTracker,
  type FailoverContext,
  type ProviderModelNode,
} from "./engine";
import type { RequestMetric } from "./telemetry/request-metric";
import { ProxyResponse } from "./proxy/proxy-response";

describe("HiveCore", () => {
  let core: HiveCore;

  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    core = new HiveCore();
  });

  it("constructs and exposes providers", () => {
    const providers = core.getProviders();
    assert.ok(Array.isArray(providers));
    assert.ok(providers.length > 0);
  });

  it("getProviderStates returns array of states", async () => {
    const states = await core.getProviderStates();
    assert.ok(Array.isArray(states));
    for (const s of states) {
      assert.ok(typeof s.provider === "string");
      assert.ok(typeof s.enabled === "boolean");
      assert.ok(typeof s.stabilityScore === "number");
    }
  });

  it("returns error when no API keys are set", async () => {
    const providers = core.getProviders();
    const envVars = providers.map((p) => p.apiKeyEnvVar);
    const unique = [...new Set(envVars)];

    for (const v of unique) {
      saved[v] = process.env[v];
      delete process.env[v];
    }

    const result = await core.handleChatCompletion({
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.statusCode, 503);
    assert.ok(result.error!.includes("No configured providers"));

    for (const v of unique) {
      if (saved[v] !== undefined) process.env[v] = saved[v];
    }
  });
});

describe("Hive Core Router Interception Loop", () => {
  beforeEach(() => {
    circuitBreaker.clear();
    empiricalDisabledFeatures.clear();
    sessionTracker.sessions.clear();
    process.env.HIVE_ROUTING_STRATEGY = "balanced";
    process.env.HIVE_MIN_TOKEN_TELEMETRY = "200";
  });

  const nodes: ProviderModelNode[] = [
    { providerName: "groq", modelName: "llama-3" },
    { providerName: "sambanova", modelName: "llama-3" },
    { providerName: "deepinfra", modelName: "llama-3" },
  ];

  const mockMetricsGenerator = (compoundKey: string): RequestMetric[] => {
    if (compoundKey.startsWith("groq")) {
      return [
        {
          requestId: "id",
          provider: "groq",
          model: "llama-3",
          timestamp: Date.now(),
          ttft: 100,
          totalLatency: 500,
          inputTokens: 300,
          outputTokens: 40,
          thinkingTime: null,
          finishReason: "stop",
          refused: false,
          statusCode: 200,
          errorType: null,
          success: true,
          source: "user",
        },
      ];
    }
    if (compoundKey.startsWith("sambanova")) {
      return [
        {
          requestId: "id",
          provider: "sambanova",
          model: "llama-3",
          timestamp: Date.now(),
          ttft: 120,
          totalLatency: 520,
          inputTokens: 300,
          outputTokens: 40,
          thinkingTime: null,
          finishReason: "stop",
          refused: false,
          statusCode: 200,
          errorType: null,
          success: true,
          source: "user",
        },
      ];
    }
    return [
      {
        requestId: "id",
        provider: "deepinfra",
        model: "llama-3",
        timestamp: Date.now(),
        ttft: 600,
        totalLatency: 2000,
        inputTokens: 300,
        outputTokens: 40,
        thinkingTime: null,
        finishReason: "stop",
        refused: false,
        statusCode: 200,
        errorType: null,
        success: true,
        source: "user",
      },
    ];
  };

  it("should select candidates inside a 5-point probability cluster range and bypass slow channels", () => {
    for (let i = 0; i < 20; i++) {
      const selected = selectBestNode(nodes, mockMetricsGenerator);
      assert.ok(
        selected!.providerName === "groq" ||
          selected!.providerName === "sambanova"
      );
      assert.notStrictEqual(selected!.providerName, "deepinfra");
    }
  });

  it("should apply warm-path sticky session bias across consecutive calls", () => {
    const sessionId = "test-session";
    sessionTracker.sessions.set(sessionId, "sambanova:llama-3");

    let sambaCount = 0;
    for (let i = 0; i < 50; i++) {
      const selected = selectBestNode(
        nodes,
        mockMetricsGenerator,
        [],
        sessionId
      );
      if (selected?.providerName === "sambanova") sambaCount++;
    }
    assert.ok(
      sambaCount > 25,
      "Warm paths must lock current interaction channels smoothly."
    );
  });

  it("should register empirical feature failures dynamically and remove lacking hosts from routing options", () => {
    const requiredFeatures = ["tools"];

    empiricalDisabledFeatures.set("groq:llama-3", new Set(["tools"]));

    for (let i = 0; i < 10; i++) {
      const selected = selectBestNode(
        nodes,
        mockMetricsGenerator,
        requiredFeatures
      );
      assert.notStrictEqual(
        selected!.providerName,
        "groq",
        "Endpoints that fail structural specifications must be dropped."
      );
    }
  });

  it("should manage fast pre-stream circuit isolation and replay payloads transparently", async () => {
    const sessionId = "circuit-test";
    sessionTracker.sessions.set(sessionId, "groq:llama-3");

    let groqCalled = false;
    let sambaCalled = false;

    const ctx: FailoverContext = {
      nodes: [
        { providerName: "groq", modelName: "llama-3" },
        { providerName: "sambanova", modelName: "llama-3" },
      ],
      originalPayload: JSON.stringify({ prompt: "test" }),
      requiredFeatures: [],
      getMetricsForNode: mockMetricsGenerator,
      sessionId,
      dispatchRequest: async (node) => {
        await Promise.resolve();
        if (node.providerName === "groq") {
          groqCalled = true;
          return ProxyResponse.error(429, "rate limit exceeded");
        }
        if (node.providerName === "sambanova") {
          sambaCalled = true;
          return ProxyResponse.ok(200, new PassThrough());
        }
        return ProxyResponse.error(500, "");
      },
    };

    const outcome = await executeProxyRequest(ctx);
    assert.strictEqual(outcome.status, 200);
    assert.ok(
      groqCalled && sambaCalled,
      "Pre-stream infrastructure drops must trigger immediate fallback transitions."
    );
    assert.ok(
      circuitBreaker.isTripped("groq:llama-3"),
      "Failing nodes must trip the breaker and be removed from rotation."
    );
  });
});
