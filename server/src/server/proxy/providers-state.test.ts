import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { getProviders } from "./providers-state.ts";
import type { ServerState } from "./server-state.ts";
import { initServerState } from "./server-state.ts";

function createEmptyServerState(): ServerState {
  return {
    getOverride: () => null,
    isProviderDisabled: () => false,
    getProviders: () => [],
  };
}

await describe("providersState", async () => {
  beforeEach(() => {
    initServerState(createEmptyServerState());
  });

  await it("getProviders returns array", () => {
    const providers = getProviders();
    assert.ok(Array.isArray(providers));
  });
});
