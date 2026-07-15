import assert from "node:assert";
import { beforeEach, describe, it } from "node:test";
import type { ServerState } from "./core-context";
import { initCore } from "./core-context";
import { handleChatCompletion } from "./handle-chat-completion";
import { getLastUsed, setLastUsed } from "./last-used-state";

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
    initCore(createEmptyServerState());
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
