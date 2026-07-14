import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import type { ServerState } from "./core-context";
import { initCore } from "./core-context";
import { getProviderStates } from "./get-provider-states";

function createEmptyServerState(): ServerState {
  return {
    getOverride: () => null,
    isProviderDisabled: () => false,
    getProviders: () => [],
  };
}

await describe("getProviderStates", async () => {
  beforeEach(() => {
    initCore(createEmptyServerState());
  });

  await it("returns array of states", async () => {
    const states = await getProviderStates();
    assert.ok(Array.isArray(states));
    for (const s of states) {
      assert.ok(typeof s.provider === "string");
      assert.ok(typeof s.enabled === "boolean");
      assert.ok(typeof s.stabilityScore === "number");
    }
  });
});
