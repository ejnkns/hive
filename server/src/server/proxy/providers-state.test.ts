import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import type { ServerState } from "./core-context";
import { initCore } from "./core-context";
import { getProviders } from "./providers-state";

function createEmptyServerState(): ServerState {
  return {
    getOverride: () => null,
    isProviderDisabled: () => false,
    getProviders: () => [],
  };
}

await describe("providersState", async () => {
  beforeEach(() => {
    initCore(createEmptyServerState());
  });

  await it("getProviders returns array", () => {
    const providers = getProviders();
    assert.ok(Array.isArray(providers));
  });
});
