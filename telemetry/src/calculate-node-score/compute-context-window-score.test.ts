import assert from "node:assert";
import { describe, it } from "node:test";
import { computeContextWindowScore } from "./compute-context-window-score";

await describe("computeContextWindowScore", async () => {
  await it("returns 100 for reference max", () => {
    assert.strictEqual(computeContextWindowScore(128_000), 100);
  });

  await it("returns higher score for larger context windows", () => {
    const small = computeContextWindowScore(8_000);
    const medium = computeContextWindowScore(32_000);
    const large = computeContextWindowScore(128_000);
    assert.ok(small < medium, `${String(small)} < ${String(medium)}`);
    assert.ok(medium < large, `${String(medium)} < ${String(large)}`);
  });

  await it("returns score between 0 and 100", () => {
    const scores = [
      1_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 1_000_000,
    ].map(computeContextWindowScore);
    for (const s of scores) {
      assert.ok(s >= 0, `score ${String(s)} >= 0`);
      assert.ok(s <= 100, `score ${String(s)} <= 100`);
    }
  });

  await it("returns diminishing returns for very large contexts", () => {
    const step1 = computeContextWindowScore(128_000);
    const step2 = computeContextWindowScore(256_000);
    const step3 = computeContextWindowScore(512_000);
    // Each doubling should add less than the previous
    assert.ok(step2 - step1 < 15, `step2-step1 ${String(step2 - step1)} < 15`);
    assert.ok(step3 - step2 < 10, `step3-step2 ${String(step3 - step2)} < 10`);
  });
});
