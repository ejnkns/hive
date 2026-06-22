import { describe, it } from 'node:test'
import assert from 'node:assert'

describe('proxy', () => {
  it('exports expected api', async () => {
    const mod = await import('./proxy.js')
    assert.ok(typeof mod.failover === 'function')
    assert.ok(typeof mod.mutateRequest === 'function')
    assert.ok(typeof mod.routeRequest === 'function')
  })
})
