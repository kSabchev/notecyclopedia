import assert from 'node:assert/strict'
import { test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import type { CalculatorSpec } from '@nc/shared'
import { reviewCalculator } from './calculator-review'
import type { createMessage } from './claude-client'

const wrong: CalculatorSpec = {
  version: 1,
  name: 'Circular orbit',
  inputs: [
    { key: 'r', label: 'Radius', unit: 'km', default: 7000 },
    { key: 'mu', label: 'Gravitational parameter', unit: 'km³/s²', default: 398600 },
  ],
  outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'mu / r^2' }],
}
const fixed: CalculatorSpec = {
  ...wrong,
  outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / r)' }],
}

/** A stand-in for Claude that answers each request with one review_calculator call. */
function fakeClaude(inputs: unknown[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = []
  const create = (async (request: Anthropic.MessageCreateParamsNonStreaming) => {
    requests.push(structuredClone(request))
    const input = inputs[requests.length - 1]
    assert.ok(input, 'Claude was called more often than expected')
    return {
      model: 'claude-sonnet-5-5',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: `call_${requests.length}`, name: 'review_calculator', input }],
    } as unknown as Anthropic.Message
  }) as typeof createMessage
  return { create, requests }
}

test('sends the automatic checks along and returns a validated correction', async () => {
  const claude = fakeClaude([
    {
      findings: [{ severity: 'error', key: 'v', message: 'This is the acceleration, not the speed.' }],
      revised: fixed,
    },
  ])
  const review = await reviewCalculator(wrong, 'user', claude.create)
  assert.deepEqual(review.findings, [
    { severity: 'error', key: 'v', message: 'This is the acceleration, not the speed.' },
  ])
  assert.equal(review.revised?.outputs[0]?.expr, 'sqrt(mu / r)')
  assert.deepEqual(review.revisedChecks, [])
  // The unit mismatch found without AI is part of the request.
  assert.match(JSON.stringify(claude.requests[0]?.messages), /\\"type\\":\\"units\\"/)
})

test('a calculator that needs no change has no revised version', async () => {
  const claude = fakeClaude([{ findings: [{ severity: 'note', message: 'All formulas are correct.' }] }])
  const review = await reviewCalculator(fixed, 'user', claude.create)
  assert.equal(review.revised, null)
  assert.equal(review.findings[0]?.key, null)
})

test('an invalid correction is sent back once to be fixed', async () => {
  const broken = { ...fixed, outputs: [{ key: 'v', label: 'Speed', expr: 'sqrt(mu / radius)' }] }
  const claude = fakeClaude([
    { findings: [], revised: broken },
    { findings: [{ severity: 'error', key: 'v', message: 'Wrong formula.' }], revised: fixed },
  ])
  const review = await reviewCalculator(wrong, 'user', claude.create)
  assert.equal(review.revised?.outputs[0]?.expr, 'sqrt(mu / r)')
  assert.match(JSON.stringify(claude.requests[1]?.messages.at(-1)), /Invalid review: revised/)

  const never = fakeClaude([
    { findings: [], revised: broken },
    { findings: [], revised: broken },
  ])
  await assert.rejects(reviewCalculator(wrong, 'user', never.create), /could not produce a valid review/)
})
