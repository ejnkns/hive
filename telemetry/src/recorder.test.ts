import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { loadCache, saveCache } from "./cache";
import { TelemetryRecorder } from "./recorder";

// TODO: Re-enable once TelemetryRecorder accepts an isolated cache adapter/path.
// These tests currently read and overwrite the live ~/.hive/telemetry-cache.json,
// so they race a running Hive server and can destroy real telemetry data.
await describe.skip("TelemetryRecorder", async () => {
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
      toolCallFailed: false,
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
      toolCallFailed: false,
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

  await it("debounce: multiple rapid metrics flush together in a single batch", async () => {
    for (let i = 0; i < 5; i++) {
      recorder.recordMetric({
        requestId: `test-${String(i)}`,
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
        toolCallFailed: false,
      });
    }

    assert.strictEqual(recorder.getPendingCount(), 5);
    await recorder.flush();

    const cache = await loadCache();
    assert.strictEqual(cache.metrics.length, 5);
    assert.strictEqual(recorder.getPendingCount(), 0);
  });

  await it("stop cancels pending debounce timer without flushing", {
    timeout: 3000,
  }, async () => {
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
      toolCallFailed: false,
    });

    assert.strictEqual(recorder.getPendingCount(), 1);
    recorder.stop();

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const cache = await loadCache();
    assert.strictEqual(cache.metrics.length, 0);
  });
});
