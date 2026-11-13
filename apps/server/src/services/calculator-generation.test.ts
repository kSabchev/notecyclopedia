import assert from 'node:assert/strict'
import { test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { generateCalculators } from './calculator-generation'
import type { createMessage } from './claude-client'

// ---------- calculator generation ----------

const speedSpec = {
  name: 'Circular speed',
  inputs: [
    { key: 'r', label: 'Radius', unit: 'km', default: 7000 },
    { key: 'mu', label: 'Gravitational parameter', unit: 'km3/s2', default: 398600 },
  ],
  outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / r)' }],
}
const periodSpec = {
  name: 'Orbital period',
  inputs: [
    { key: 'a', label: 'Semi-major axis', unit: 'km', default: 7000 },
    { key: 'mu', label: 'Gravitational parameter', unit: 'km3/s2', default: 398600 },
  ],
  outputs: [{ key: 'T', label: 'Period', unit: 's', expr: '2 * pi * sqrt(a^3 / mu)' }],
}
// What a reply cut off at max_tokens looks like: the outputs never arrived.
const { outputs: _cut, ...truncatedSpec } = periodSpec

type Reply = { stop: 'end_turn' | 'max_tokens' | 'tool_use'; calls: unknown[] }
/** A stand-in for Claude that answers with the given save_calculator calls, and records the requests. */
function fakeClaude(replies: Reply[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = []
  const create = (async (request: Anthropic.MessageCreateParamsNonStreaming) => {
    requests.push(structuredClone(request))
    const reply = replies[requests.length - 1]
    assert.ok(reply, 'Claude was called more often than expected')
    return {
      stop_reason: reply.stop,
      content: reply.calls.map((input, i) => ({
        type: 'tool_use',
        id: `call_${requests.length}_${i}`,
        name: 'save_calculator',
        input,
      })),
    } as unknown as Anthropic.Message
  }) as typeof createMessage
  return { create, requests }
}
const lastToolResults = (request: Anthropic.MessageCreateParamsNonStreaming) =>
  JSON.stringify(request.messages.at(-1)?.content)

test('one request can make several calculators', async () => {
  const claude = fakeClaude([{ stop: 'tool_use', calls: [speedSpec, periodSpec] }])
  const made = await generateCalculators('two problems', 'user', undefined, claude.create)
  assert.deepEqual(
    made.calculators.map((c) => c.name),
    ['Circular speed', 'Orbital period'],
  )
  assert.deepEqual(made.failed, [])
  assert.equal(claude.requests.length, 1)
  // Room for theory, explanations and thinking; 2048 tokens used to cut calculators off.
  assert.equal(claude.requests[0]?.max_tokens, 16000)
})

test('only the invalid calculators are sent back to be fixed', async () => {
  const claude = fakeClaude([
    { stop: 'tool_use', calls: [speedSpec, truncatedSpec] },
    { stop: 'tool_use', calls: [periodSpec] },
  ])
  const made = await generateCalculators('two problems', 'user', undefined, claude.create)
  assert.deepEqual(
    made.calculators.map((c) => c.name),
    ['Circular speed', 'Orbital period'],
  )
  const retry = lastToolResults(claude.requests[1] as Anthropic.MessageCreateParamsNonStreaming)
  assert.match(retry, /Saved \\"Circular speed\\"/)
  assert.match(retry, /Invalid calculator: outputs: Required/)
})

test('a fixed calculator sent again replaces the earlier version', async () => {
  const broken = { ...speedSpec, outputs: [{ key: 'v', label: 'Speed', expr: 'sqrt(mu / radius)' }] }
  const claude = fakeClaude([
    { stop: 'tool_use', calls: [periodSpec, broken] },
    { stop: 'tool_use', calls: [periodSpec, speedSpec] },
  ])
  const made = await generateCalculators('two problems', 'user', undefined, claude.create)
  assert.deepEqual(
    made.calculators.map((c) => c.name),
    ['Orbital period', 'Circular speed'],
  )
})

test('keeps the valid calculators and reports the ones that stay invalid', async () => {
  const claude = fakeClaude([
    { stop: 'tool_use', calls: [speedSpec, truncatedSpec] },
    { stop: 'tool_use', calls: [truncatedSpec] },
    { stop: 'tool_use', calls: [truncatedSpec] },
  ])
  const made = await generateCalculators('two problems', 'user', undefined, claude.create)
  assert.deepEqual(
    made.calculators.map((c) => c.name),
    ['Circular speed'],
  )
  assert.match(made.failed[0] ?? '', /outputs: Required/)
})

test('a cut-off reply is explained to Claude, and a lasting failure names the cause', async () => {
  const claude = fakeClaude([
    { stop: 'max_tokens', calls: [truncatedSpec] },
    { stop: 'max_tokens', calls: [truncatedSpec] },
    { stop: 'max_tokens', calls: [truncatedSpec] },
  ])
  await assert.rejects(
    generateCalculators('one problem', 'user', undefined, claude.create),
    /could not produce a valid calculator: outputs: Required/,
  )
  assert.match(
    lastToolResults(claude.requests[1] as Anthropic.MessageCreateParamsNonStreaming),
    /cut off at the output limit/,
  )
})
