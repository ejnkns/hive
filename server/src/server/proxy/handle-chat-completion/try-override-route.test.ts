import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import type { ProxyResponse } from "../proxy-response";
import { routingMemory } from "../routing-memory";
import { tryOverrideRoute } from "./try-override-route";

function mockProxyResponse(status: number): ProxyResponse {
  return {
    isOk: () => status >= 200 && status < 400,
    getStream: () => null as never,
    getNormalizedError: async () => {
      if (status === 403) return { type: "auth-error" as const };
      if (status === 429) return { type: "rate-limited" as const };
      return { type: "server-error" as const };
    },
    status,
  } as unknown as ProxyResponse;
}

await describe("tryOverrideRoute", async () => {
  beforeEach(() => {
    routingMemory.reset();
  });

  await it("returns the result when override node succeeds", async () => {
    const result = await tryOverrideRoute({
      overrideNode: { providerName: "test", modelName: "test-model" },
      dispatch: async () => mockProxyResponse(200),
      payloadStr: "{}",
      requestId: "test-request",
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(result?.success, true);
    assert.strictEqual(result?.provider, "test");
  });

  await it("returns null and trips circuit breaker when override returns error response", async () => {
    const result = await tryOverrideRoute({
      overrideNode: { providerName: "test", modelName: "test-model" },
      dispatch: async () => mockProxyResponse(403),
      payloadStr: "{}",
      requestId: "test-request",
    });

    assert.strictEqual(result, null);
    assert.strictEqual(
      routingMemory.isNodeEligible("test:test-model", []),
      false,
      "circuit breaker should be tripped on override error"
    );
  });

  await it("returns null and trips circuit breaker when dispatch throws", async () => {
    const result = await tryOverrideRoute({
      overrideNode: { providerName: "test", modelName: "test-model" },
      dispatch: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      payloadStr: "{}",
      requestId: "test-request",
    });

    assert.strictEqual(result, null);
    assert.strictEqual(
      routingMemory.isNodeEligible("test:test-model", []),
      false,
      "circuit breaker should be tripped on network failure"
    );
  });

  await it("returns null immediately when no override node is set", async () => {
    let dispatched = false;
    const result = await tryOverrideRoute({
      overrideNode: null,
      dispatch: async () => {
        dispatched = true;
        return mockProxyResponse(200);
      },
      payloadStr: "{}",
      requestId: "test-request",
    });

    assert.strictEqual(result, null);
    assert.strictEqual(dispatched, false);
  });
});
