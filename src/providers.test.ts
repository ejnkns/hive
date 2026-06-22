import { describe, it } from "node:test";
import assert from "node:assert";
import { providers } from "./providers.js";

describe("providers", () => {
  it("registers all 4 providers", () => {
    assert.strictEqual(providers.length, 4);
    assert.strictEqual(providers[0].name, "groq");
    assert.strictEqual(providers[1].name, "sambanova");
    assert.strictEqual(providers[2].name, "nvidia-nim");
    assert.strictEqual(providers[3].name, "opencode-zen");
  });
});
