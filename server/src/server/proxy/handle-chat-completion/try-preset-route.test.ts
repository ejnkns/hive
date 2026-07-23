import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import type { Node, RequestMetric } from "telemetry";
import type { ProxyResponse } from "../proxy-response";
import { routingMemory } from "../routing-memory";
import { tryPresetRoute } from "./try-preset-route";

function mockProxyResponse(status: number): ProxyResponse {
  return {
    isOk: () => status >= 200 && status < 400,
    getStream: () => null as never,
    getNormalizedError: async () => {
      if (status === 403) return { type: "auth-error" as const };
      if (status === 429) return { type: "rate-limited" as const };
      return { type: "server-error" as const };
    },
    getBodyAsString: async () => "mock error body",
    status,
  } as unknown as ProxyResponse;
}

function node(providerName: string, modelName: string): Node {
  return { providerName, modelName };
}

function emptyMetrics(): RequestMetric[] {
  return [];
}

await describe("tryPresetRoute", async () => {
  beforeEach(() => {
    routingMemory.reset();
  });

  await it("succeeds via first model in auto-routing mode (no providerPriority)", async () => {
    const result = await tryPresetRoute({
      modelPriority: ["model-a"],
      providerPriority: undefined,
      nodes: [node("prov-a", "model-a")],
      dispatch: async () => mockProxyResponse(200),
      payloadStr: "{}",
      requestId: "test-1",
      getMetricsForNode: emptyMetrics,
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(result?.success, true);
    assert.strictEqual(result?.provider, "prov-a");
    assert.strictEqual(result?.model, "model-a");
  });

  await it("succeeds via first model+provider in strict providerPriority mode", async () => {
    const result = await tryPresetRoute({
      modelPriority: ["model-a"],
      providerPriority: ["prov-a"],
      nodes: [node("prov-a", "model-a")],
      dispatch: async () => mockProxyResponse(200),
      payloadStr: "{}",
      requestId: "test-2",
      getMetricsForNode: emptyMetrics,
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(result?.success, true);
    assert.strictEqual(result?.provider, "prov-a");
    assert.strictEqual(result?.model, "model-a");
  });

  await it("skips model not on any qualified provider, succeeds on next model", async () => {
    const result = await tryPresetRoute({
      modelPriority: ["model-missing", "model-b"],
      providerPriority: undefined,
      nodes: [node("prov-b", "model-b")],
      dispatch: async () => mockProxyResponse(200),
      payloadStr: "{}",
      requestId: "test-3",
      getMetricsForNode: emptyMetrics,
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(result?.success, true);
    assert.strictEqual(result?.model, "model-b");
  });

  await it("fails through first model dispatch error, succeeds on second model", async () => {
    let callCount = 0;
    const dispatch = async () => {
      callCount++;
      if (callCount === 1) return mockProxyResponse(500);
      return mockProxyResponse(200);
    };

    const result = await tryPresetRoute({
      modelPriority: ["model-a", "model-b"],
      providerPriority: undefined,
      nodes: [node("prov-a", "model-a"), node("prov-b", "model-b")],
      dispatch,
      payloadStr: "{}",
      requestId: "test-4",
      getMetricsForNode: emptyMetrics,
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(result?.success, true);
    assert.strictEqual(result?.model, "model-b");
    assert.strictEqual(
      routingMemory.isCircuitBroken("prov-a:model-a"),
      true,
      "failed model should be circuit-broken"
    );
  });

  await it("skips provider not serving current model in strict priority mode", async () => {
    let dispatchedTo: string | null = null;
    const dispatch = async (n: Node) => {
      dispatchedTo = `${n.providerName}:${n.modelName}`;
      return mockProxyResponse(200);
    };

    const result = await tryPresetRoute({
      modelPriority: ["model-a"],
      providerPriority: ["prov-x", "prov-a"],
      nodes: [node("prov-a", "model-a")],
      dispatch,
      payloadStr: "{}",
      requestId: "test-5",
      getMetricsForNode: emptyMetrics,
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(dispatchedTo, "prov-a:model-a");
  });

  await it("returns null when no models match any nodes", async () => {
    let dispatched = false;
    const result = await tryPresetRoute({
      modelPriority: ["model-x", "model-y"],
      providerPriority: undefined,
      nodes: [],
      dispatch: async () => {
        dispatched = true;
        return mockProxyResponse(200);
      },
      payloadStr: "{}",
      requestId: "test-6",
      getMetricsForNode: emptyMetrics,
    });

    assert.strictEqual(result, null);
    assert.strictEqual(dispatched, false);
  });

  await it("calls onSuccess with selected provider and model", async () => {
    let callbackProvider: string | null = null;
    let callbackModel: string | null = null;

    await tryPresetRoute({
      modelPriority: ["model-a"],
      providerPriority: undefined,
      nodes: [node("prov-a", "model-a")],
      dispatch: async () => mockProxyResponse(200),
      payloadStr: "{}",
      requestId: "test-7",
      getMetricsForNode: emptyMetrics,
      onSuccess: (provider, model) => {
        callbackProvider = provider;
        callbackModel = model;
      },
    });

    assert.strictEqual(callbackProvider, "prov-a");
    assert.strictEqual(callbackModel, "model-a");
  });
});
