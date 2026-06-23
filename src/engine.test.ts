import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { HiveCore } from "./engine";

describe("HiveCore", () => {
  let core: HiveCore;

  const KEY_VARS = [
    "GROQ_API_KEY",
    "SAMBA_NOVA_API_KEY",
    "NVIDIA_NIM_API_KEY",
    "OPENCODE_ZEN_API_KEY",
  ];

  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    core = new HiveCore();
  });

  it("constructs and exposes providers", () => {
    const providers = core.getProviders();
    assert.ok(Array.isArray(providers));
    assert.ok(providers.length > 0);
  });

  it("getProviderStates returns array of states", async () => {
    const states = await core.getProviderStates();
    assert.ok(Array.isArray(states));
    for (const s of states) {
      assert.ok(typeof s.provider === "string");
      assert.ok(typeof s.enabled === "boolean");
      assert.ok(typeof s.stabilityScore === "number");
    }
  });

  it("returns error when no API keys are set", async () => {
    for (const v of KEY_VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }

    const result = await core.handleChatCompletion({
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.statusCode, 503);
    assert.ok(result.error!.includes("No configured providers"));

    for (const v of KEY_VARS) {
      if (saved[v] !== undefined) process.env[v] = saved[v];
    }
  });
});
