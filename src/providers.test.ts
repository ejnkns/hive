import { describe, it } from 'node:test'
import assert from 'node:assert'
import { providers } from './providers.js'

describe('providers', () => {
  it('registers groq and sambanova', () => {
    assert.strictEqual(providers.length, 2)
    assert.strictEqual(providers[0].name, 'groq')
    assert.strictEqual(providers[1].name, 'sambanova')
  })
})
