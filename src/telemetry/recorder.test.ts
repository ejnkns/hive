import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { TelemetryRecorder } from "./recorder";
import { loadCache, saveCache } from "./persist";

await describe("TelemetryRecorder", async () => {
  let recorder: TelemetryRecorder;

  beforeEach(async () => {
    recorder = new TelemetryRecorder();
    await saveCache({ metrics: [], scores: [] });
  });

  afterEach(() => {
    recorder.stop();
  });

  await it("records metrics in memory buffer", () => {
    recorder.recordMetric({
      requestId: "test-id",
      provider: "test",
      model: "test-model",
      timestamp: Date.now(),
      ttft: 100,
      totalLatency: 500,
      inputTokens: 10,
      outputTokens: 50,
      thinkingTime: null,
      finishReason: null,
      refused: false,
      statusCode: 200,
      errorType: null,
      success: true,
      source: "user",
    });

    assert.strictEqual(recorder.getPendingCount(), 1);
  });

  await it("flush persists to cache and clears buffer", async () => {
    recorder.recordMetric({
      requestId: "test-id",
      provider: "test",
      model: "test-model",
      timestamp: Date.now(),
      ttft: 100,
      totalLatency: 500,
      inputTokens: 10,
      outputTokens: 50,
      thinkingTime: null,
      finishReason: null,
      refused: false,
      statusCode: 200,
      errorType: null,
      success: true,
      source: "user",
    });

    await recorder.flush();

    const cache = await loadCache();
    assert.strictEqual(cache.metrics.length, 1);
    assert.strictEqual(recorder.getPendingCount(), 0);
  });

  await it("empty buffer does not write on flush", async () => {
    const cacheBefore = await loadCache();
    await recorder.flush();
    const cacheAfter = await loadCache();
    assert.strictEqual(cacheAfter.metrics.length, cacheBefore.metrics.length);
  });
});
