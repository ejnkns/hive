import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { createRoutingMemory, routingMemory } from "./routing-memory";

await describe("RoutingMemory", async () => {
  beforeEach(() => {
    routingMemory.reset();
  });

  await describe("isNodeEligible", async () => {
    await it("returns true for a healthy node", () => {
      assert.ok(routingMemory.isNodeEligible("p:m", []));
    });

    await it("returns false when circuit breaker is tripped via upstream error", () => {
      routingMemory.recordUpstreamError("p:m", "auth-error", []);
      assert.strictEqual(routingMemory.isNodeEligible("p:m", []), false);
    });

    await it("returns false when circuit breaker is tripped via network failure", () => {
      routingMemory.recordNetworkFailure("p:m");
      assert.strictEqual(routingMemory.isNodeEligible("p:m", []), false);
    });

    await it("returns true after circuit breaker cooldown expires", () => {
      const slow = createRoutingMemory();
      slow.recordNetworkFailure("p:m");
      assert.strictEqual(slow.isNodeEligible("p:m", []), false);
    });

    await it("returns false when required features are unsupported", () => {
      routingMemory.recordUpstreamError("p:m", "unsupported-feature", [
        "tools",
      ]);
      assert.strictEqual(routingMemory.isNodeEligible("p:m", ["tools"]), false);
    });

    await it("returns true when unsupported features differ from required", () => {
      routingMemory.recordUpstreamError("p:m", "unsupported-feature", [
        "tools",
      ]);
      assert.ok(routingMemory.isNodeEligible("p:m", ["other"]));
    });

    await it("ignores unknown error types (no-op)", () => {
      routingMemory.recordUpstreamError("p:m", "unknown", []);
      assert.ok(routingMemory.isNodeEligible("p:m", []));
    });
  });

  await describe("session affinity", async () => {
    await it("stores and retrieves node affinity per session", () => {
      routingMemory.setNodeAffinity("s1", "p1:m1");
      assert.strictEqual(routingMemory.getNodeAffinity("s1"), "p1:m1");
    });

    await it("returns undefined for unset session", () => {
      assert.strictEqual(routingMemory.getNodeAffinity("unknown"), undefined);
    });

    await it("evicts oldest session when exceeding max entries", () => {
      for (let i = 0; i <= 1000; i++) {
        routingMemory.setNodeAffinity(
          `session-${String(i)}`,
          `node-${String(i)}`
        );
      }
      assert.strictEqual(
        routingMemory.getNodeAffinity("session-0"),
        undefined,
        "Oldest session should be evicted"
      );
      assert.ok(
        routingMemory.getNodeAffinity("session-1000"),
        "Newest session should be present"
      );
    });
  });

  await describe("reset", async () => {
    await it("clears all state", () => {
      routingMemory.recordNetworkFailure("p:m");
      routingMemory.setNodeAffinity("s1", "p1:m1");
      routingMemory.recordUpstreamError("p:m2", "unsupported-feature", [
        "tools",
      ]);
      routingMemory.reset();
      assert.ok(routingMemory.isNodeEligible("p:m", []));
      assert.strictEqual(routingMemory.getNodeAffinity("s1"), undefined);
      assert.ok(routingMemory.isNodeEligible("p:m2", ["tools"]));
    });
  });
});
