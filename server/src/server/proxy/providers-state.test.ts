import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { getProviders } from "./providers-state";
import type { ServerState } from "./server-state";
import { initServerState } from "./server-state";

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
