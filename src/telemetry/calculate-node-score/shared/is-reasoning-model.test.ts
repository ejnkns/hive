import { describe, it } from "node:test";
import assert from "node:assert";
import { isReasoningModel } from "./is-reasoning-model";

await describe("isReasoningModel", async () => {
  await it("matches deepseek-r1", () => {
    assert.strictEqual(isReasoningModel("deepseek-r1"), true);
  });

  await it("matches o1 models", () => {
    assert.strictEqual(isReasoningModel("gpt-o1-preview"), true);
  });

  await it("matches o3 models", () => {
    assert.strictEqual(isReasoningModel("o3-mini"), true);
  });

  await it("matches thinking models", () => {
    assert.strictEqual(isReasoningModel("claude-thinking"), true);
  });

  await it("does not match standard models", () => {
    assert.strictEqual(isReasoningModel("llama-3-70b"), false);
    assert.strictEqual(isReasoningModel("gpt-4o"), false);
    assert.strictEqual(isReasoningModel("claude-3.5-sonnet"), false);
  });
});
