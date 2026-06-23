import { describe, it, after } from 'node:test'
import assert from 'node:assert'

describe('hive', () => {
  let mod: any

  it('loads without error', async () => {
    mod = await import('./hive')
    assert.ok(mod.server)
  })

  after(() => {
    if (mod) {
      mod.server.close()
      mod.hiveCore.shutdown()
    }
  })
})
