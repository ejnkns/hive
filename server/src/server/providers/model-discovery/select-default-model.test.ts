import assert from "node:assert";
import { describe, it } from "node:test";
import { selectDefaultModel } from "./select-default-model";

const groqPreferences = [
  "deepseek-r1-distill-llama-70b",
  "llama-3.3-70b-versatile",
  "mixtral-8x7b-32768",
];

await describe("selectDefaultModel", async () => {
  await it("selects the highest priority model from the preference list", () => {
    const fetched = ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"];
    const selected = selectDefaultModel(
      fetched,
      "fallback-default",
      groqPreferences
    );
    assert.strictEqual(selected, "llama-3.3-70b-versatile");
  });

  await it("returns the highest ranked priority model even if out of order in fetched", () => {
    const fetched = ["mixtral-8x7b-32768", "deepseek-r1-distill-llama-70b"];
    const selected = selectDefaultModel(
      fetched,
      "fallback-default",
      groqPreferences
    );
    assert.strictEqual(selected, "deepseek-r1-distill-llama-70b");
  });

  await it("falls back to the hardcoded baseline default if no preferred model is found but fallback exists", () => {
    const fetched = ["unknown-model-1", "fallback-default"];
    const selected = selectDefaultModel(
      fetched,
      "fallback-default",
      groqPreferences
    );
    assert.strictEqual(selected, "fallback-default");
  });

  await it("falls back to the first fetched model if preference list and baseline default are absent", () => {
    const fetched = ["some-random-model", "another-random-model"];
    const selected = selectDefaultModel(
      fetched,
      "fallback-default",
      groqPreferences
    );
    assert.strictEqual(selected, "some-random-model");
  });

  await it("falls back to the original fallback default if fetched list is empty", () => {
    const fetched: string[] = [];
    const selected = selectDefaultModel(
      fetched,
      "fallback-default",
      groqPreferences
    );
    assert.strictEqual(selected, "fallback-default");
  });
});
