import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { getProviderStates } from "./get-provider-states";
import type { ServerState } from "./server-state";
import { initServerState } from "./server-state";

function createEmptyServerState(): ServerState {
  return {
    getOverride: () => null,
    isProviderDisabled: () => false,
    getProviders: () => [],
  };
}

await describe("getProviderStates", async () => {
  beforeEach(() => {
    initServerState(createEmptyServerState());
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
