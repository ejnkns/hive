import assert from "node:assert";
import { PassThrough } from "node:stream";
import { beforeEach, describe, it } from "node:test";
import {
  getLastUsed,
  getProviderStates,
  getProviders,
  handleChatCompletion,
  setLastUsed,
} from "./hive-core";
import {
  executeProxyRequest,
  type FailoverContext,
  ProxyResponse,
  routingMemory,
} from "./proxy";
import type { RequestMetric } from "./telemetry";

await describe("HiveCore module", async () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    setLastUsed(null, null);
  });

  await it("getProviders returns array", () => {
    const providers = getProviders();
    assert.ok(Array.isArray(providers));
    assert.ok(providers.length > 0);
  });

  await it("getProviderStates returns array of states", async () => {
    const states = await getProviderStates();
    assert.ok(Array.isArray(states));
    for (const s of states) {
      assert.ok(typeof s.provider === "string");
      assert.ok(typeof s.enabled === "boolean");
      assert.ok(typeof s.stabilityScore === "number");
    }
  });

  await it("returns error when no API keys are set", async () => {
    const providers = getProviders();
    const envVars = providers.map((p) => p.apiKeyEnvVar);
    const unique = [...new Set(envVars)];

    for (const v of unique) {
      saved[v] = process.env[v];
      process.env[v] = "";
    }

    const result = await handleChatCompletion({
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.statusCode, 503);
    assert.ok(result.error?.includes("No configured providers") ?? false);

    for (const v of unique) {
      if (saved[v] !== undefined) process.env[v] = saved[v];
    }
  });

  await it("getLastUsed returns initial state", () => {
    const last = getLastUsed();
    assert.strictEqual(last.provider, null);
    assert.strictEqual(last.model, null);
  });
});

await describe("Hive Core Router Interception Loop", async () => {
  beforeEach(() => {
    routingMemory.reset();
    process.env.HIVE_ROUTING_STRATEGY = "balanced";
    process.env.HIVE_MIN_TOKEN_TELEMETRY = "200";
  });

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
          toolCallFailed: false,
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
          toolCallFailed: false,
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
        toolCallFailed: false,
      },
    ];
  };

  await it("should manage fast pre-stream circuit isolation and replay payloads transparently", async () => {
    const sessionId = "circuit-test";
    routingMemory.setNodeAffinity(sessionId, "groq:llama-3");

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
    assert.ok(groqCalled, "groq should have been called");
    assert.ok(sambaCalled, "sambanova should have been called");
    assert.ok(
      !routingMemory.isNodeEligible("groq:llama-3", []),
      "Failing nodes must trip the breaker and be removed from rotation."
    );
  });
});

await describe("Hive Core Router — abort signal", async () => {
  beforeEach(() => {
    routingMemory.reset();
    process.env.HIVE_ROUTING_STRATEGY = "balanced";
    process.env.HIVE_MIN_TOKEN_TELEMETRY = "200";
  });

  await it("skips failover when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    let dispatchCalled = false;

    const ctx: FailoverContext = {
      nodes: [
        { providerName: "groq", modelName: "llama-3" },
        { providerName: "sambanova", modelName: "llama-3" },
      ],
      originalPayload: JSON.stringify({ prompt: "test" }),
      requiredFeatures: [],
      getMetricsForNode: () => [],
      signal: controller.signal,
      dispatchRequest: async () => {
        dispatchCalled = true;
        return ProxyResponse.ok(200, new PassThrough());
      },
    };

    await assert.rejects(
      () => executeProxyRequest(ctx),
      /All qualifying upstream endpoints failed/
    );

    assert.strictEqual(
      dispatchCalled,
      false,
      "no dispatch should be attempted when signal is aborted"
    );
  });

  await it("aborts failover mid-loop: second node not dispatched after signal fires", async () => {
    const controller = new AbortController();

    let firstCalled = false;
    let secondCalled = false;

    const ctx: FailoverContext = {
      nodes: [
        { providerName: "groq", modelName: "llama-3" },
        { providerName: "sambanova", modelName: "llama-3" },
      ],
      originalPayload: JSON.stringify({ prompt: "test" }),
      requiredFeatures: [],
      getMetricsForNode: () => [],
      signal: controller.signal,
      dispatchRequest: async (node) => {
        if (node.providerName === "groq") {
          firstCalled = true;
          controller.abort();
          return ProxyResponse.error(429, "rate limit exceeded");
        }
        secondCalled = true;
        return ProxyResponse.ok(200, new PassThrough());
      },
    };

    let threw = false;
    try {
      await executeProxyRequest(ctx);
    } catch {
      threw = true;
    }

    assert.ok(firstCalled, "first node should be dispatched");
    assert.strictEqual(
      secondCalled,
      false,
      "second node should be skipped after abort"
    );
    assert.ok(
      threw,
      "executeProxyRequest should throw when signal aborts during failover"
    );
  });
});
