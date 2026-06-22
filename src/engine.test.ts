import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import { HiveCore } from './engine.js'

describe('HiveCore', () => {
  let core: HiveCore

  beforeEach(() => {
    core = new HiveCore()
  })

  it('constructs and exposes providers', () => {
    const providers = core.getProviders()
    assert.ok(Array.isArray(providers))
    assert.ok(providers.length > 0)
  })

  it('getProviderStates returns array of states', async () => {
    const states = await core.getProviderStates()
    assert.ok(Array.isArray(states))
    for (const s of states) {
      assert.ok(typeof s.provider === 'string')
      assert.ok(typeof s.enabled === 'boolean')
      assert.ok(typeof s.stabilityScore === 'number')
    }
  })

  it('returns error when no API keys are set', async () => {
    const result = await core.handleChatCompletion({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    })
    assert.strictEqual(result.success, false)
    assert.strictEqual(result.statusCode, 503)
    assert.ok(result.error!.includes('No configured providers'))
  })
})
