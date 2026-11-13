import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UsageMeter } from './claude-client'

test('the usage meter sums calls and their estimated cost', () => {
  const meter = new UsageMeter()
  assert.equal(meter.total(), null)
  meter.add('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000 })
  meter.add('claude-sonnet-5-5', { input_tokens: 100, output_tokens: 50 })
  const total = meter.total()
  assert.ok(total)
  assert.deepEqual(total.models, ['claude-sonnet-5-5'])
  assert.equal(total.inputTokens, 1100)
  assert.equal(total.cacheReadTokens, 2000)
  // (1100 × $2 + 550 × $10 + 2000 × $0.20) per million tokens.
  assert.ok(total.costUsd !== null && Math.abs(total.costUsd - 0.0081) < 1e-9)
  meter.add('some-unpriced-model', { input_tokens: 1, output_tokens: 1 })
  assert.equal(meter.total()?.costUsd, null)
  assert.deepEqual(meter.total()?.models, ['claude-sonnet-5-5', 'some-unpriced-model'])
})
