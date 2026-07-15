import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import { handleChatCompletion } from "./handle-chat-completion";
import { getLastUsed, setLastUsed } from "./last-used-state";
import type { ServerState } from "./server-state";
import { initServerState } from "./server-state";

function createEmptyServerState(): ServerState {
  return {
    getOverride: () => null,
    isProviderDisabled: () => false,
    getProviders: () => [],
  };
}

await describe("handleChatCompletion", async () => {
  beforeEach(() => {
    setLastUsed(null, null);
    initServerState(createEmptyServerState());
  });

  await it("returns error when no providers available", async () => {
    const result = await handleChatCompletion({
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.statusCode, 503);
    assert.ok(result.error?.includes("No configured providers") ?? false);
  });
});

await describe("lastUsedState", async () => {
  beforeEach(() => {
    setLastUsed(null, null);
  });

  await it("getLastUsed returns initial state", () => {
    const last = getLastUsed();
    assert.strictEqual(last.provider, null);
    assert.strictEqual(last.model, null);
  });
});
