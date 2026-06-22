import { describe, it } from 'node:test'
import assert from 'node:assert'

describe('telemetry', () => {
  it('exports expected api', async () => {
    const mod = await import('./telemetry.js')
    assert.ok(typeof mod.calculateScore === 'function')
    assert.ok(typeof mod.startHeartbeat === 'function')
    assert.ok(typeof mod.loadState === 'function')
    assert.ok(typeof mod.saveState === 'function')
    assert.ok(typeof mod.slidingWindow === 'function')
    assert.ok(typeof mod.TelemetryRecorder === 'function')
    assert.ok(typeof mod.telemetryRecorder === 'object')
  })
})
