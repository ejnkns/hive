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

  await it("requires provider and model together for an exact playground route", async () => {
    const result = await handleChatCompletion(
      {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      { "x-hive-playground-provider": "test-provider" }
    );

    assert.equal(result.success, false);
    assert.equal(result.statusCode, 400);
    assert.match(result.error ?? "", /both provider and model/);
  });

  await it("reports an unavailable exact playground provider", async () => {
    const result = await handleChatCompletion(
      {
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      },
      {
        "x-hive-playground-provider": "test-provider",
        "x-hive-playground-model": "test-model",
      }
    );

    assert.equal(result.success, false);
    assert.equal(result.statusCode, 503);
    assert.match(result.error ?? "", /unavailable/);
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
