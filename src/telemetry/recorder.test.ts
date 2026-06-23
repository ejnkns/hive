import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { TelemetryRecorder } from './recorder'
import { loadState } from './persistence'

describe('TelemetryRecorder', () => {
  let recorder: TelemetryRecorder

  beforeEach(() => {
    recorder = new TelemetryRecorder()
  })

  afterEach(() => {
    recorder.stop()
  })

  it('records metrics in memory buffer', () => {
    recorder.recordMetric({
      provider: 'test',
      model: 'test-model',
      ttft: 100,
      statusCode: 200,
      success: true,
      timestamp: Date.now(),
    })

    assert.strictEqual((recorder as any).buffer.length, 1)
  })

  it('flush persists to state and clears buffer', async () => {
    recorder.recordMetric({
      provider: 'test',
      model: 'test-model',
      ttft: 100,
      statusCode: 200,
      success: true,
      timestamp: Date.now(),
    })

    await recorder.flush()

    const state = await loadState()
    assert.strictEqual(state.metrics.length, 1)
    assert.strictEqual((recorder as any).buffer.length, 0)
  })

  it('empty buffer does not write on flush', async () => {
    const stateBefore = await loadState()
    await recorder.flush()
    const stateAfter = await loadState()
    assert.strictEqual(stateAfter.metrics.length, stateBefore.metrics.length)
  })
})
