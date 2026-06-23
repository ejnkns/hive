import { describe, it } from "node:test";
import assert from "node:assert";
import { providers } from "./providers";

describe("providers", () => {
  it("registers all 6 providers", () => {
    assert.strictEqual(providers.length, 6);
    assert.strictEqual(providers[0].name, "groq");
    assert.strictEqual(providers[1].name, "sambanova");
    assert.strictEqual(providers[2].name, "nvidia-nim");
    assert.strictEqual(providers[3].name, "opencode-zen");
    assert.strictEqual(providers[4].name, "google-ai");
    assert.strictEqual(providers[5].name, "github-models");
  });
});
