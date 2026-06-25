import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { HiveCore } from "./engine";

describe("HiveCore", () => {
  let core: HiveCore;

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
    const providers = core.getProviders();
    const envVars = providers.map((p) => p.apiKeyEnvVar);
    const unique = [...new Set(envVars)];

    for (const v of unique) {
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

    for (const v of unique) {
      if (saved[v] !== undefined) process.env[v] = saved[v];
    }
  });
});
