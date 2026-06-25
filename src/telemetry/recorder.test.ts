import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { TelemetryRecorder } from './recorder'
import { loadCache, saveCache } from './persist'

describe('TelemetryRecorder', () => {
  let recorder: TelemetryRecorder

  beforeEach(async () => {
    recorder = new TelemetryRecorder()
    await saveCache({ metrics: [], scores: [] })
  })

  afterEach(() => {
    recorder.stop()
  })

  it('records metrics in memory buffer', () => {
    recorder.recordMetric({
      provider: 'test',
      model: 'test-model',
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
      source: 'user',
    })

    assert.strictEqual((recorder as any).buffer.length, 1)
  })

  it('flush persists to cache and clears buffer', async () => {
    recorder.recordMetric({
      provider: 'test',
      model: 'test-model',
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
      source: 'user',
    })

    await recorder.flush()

    const cache = await loadCache()
    assert.strictEqual(cache.metrics.length, 1)
    assert.strictEqual((recorder as any).buffer.length, 0)
  })

  it('empty buffer does not write on flush', async () => {
    const cacheBefore = await loadCache()
    await recorder.flush()
    const cacheAfter = await loadCache()
    assert.strictEqual(cacheAfter.metrics.length, cacheBefore.metrics.length)
  })
})
