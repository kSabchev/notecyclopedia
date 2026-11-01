import assert from 'node:assert/strict'
import { test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import {
  type CalculatorLibrary,
  type ChatTurn,
  type LibraryCalculator,
  boundHistory,
  generateCalculators,
  orbitFromTool,
  runChatTool,
} from './claude'
import { UsageMeter, type createMessage } from './claude-client'

const user = (content: string): ChatTurn => ({ role: 'user', content })
const assistant = (content: string): ChatTurn => ({ role: 'assistant', content })

test('keeps the most recent turns within the character budget', () => {
  const turns = [
    user('a'.repeat(50)),
    assistant('b'.repeat(50)),
    user('c'.repeat(20)),
    assistant('d'.repeat(20)),
  ]
  assert.deepEqual(boundHistory(turns, 60), [turns[2], turns[3]])
})

test('caps the number of turns and starts with a user turn', () => {
  const turns = [user('1'), assistant('2'), user('3'), assistant('4')]
  assert.deepEqual(boundHistory(turns, 1000, 3), [turns[2], turns[3]])
})

test('drops empty turns, which the API rejects', () => {
  const turns = [user('question'), assistant(''), user('again')]
  assert.deepEqual(boundHistory(turns), [turns[0], turns[2]])
})

test('accepts a valid show_orbit call as an orbit widget', () => {
  const result = orbitFromTool({ body: 'earth', a: 26600, e: 0.74, i: 63.4, raan: 0, argp: 270, nu: 0 })
  assert.ok('widget' in result)
  assert.equal(result.widget.kind, 'orbit')
})

test('explains an invalid show_orbit call so Claude can retry', () => {
  const result = orbitFromTool({ body: 'earth', a: 7000, e: 1.3, i: 10, raan: 0, argp: 0, nu: 0 })
  assert.ok('error' in result)
  assert.match(result.error, /elements\.e/)
  assert.match(result.error, /closed orbits/)
})

const period: LibraryCalculator = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Orbital period',
  spec: {
    version: 1,
    name: 'Orbital period',
    inputs: [
      { key: 'a', label: 'Semi-major axis', unit: 'km', default: 7000 },
      { key: 'mu', label: 'Gravitational parameter', unit: 'km³/s²', default: 398600.4418 },
    ],
    outputs: [{ key: 'T', label: 'Period', unit: 's', expr: '2 * pi * sqrt(a^3 / mu)', precision: 0 }],
  },
}
const library: CalculatorLibrary = {
  find: async (query) => (/period/i.test(query) ? [period] : []),
  get: async (id) => (id === period.id ? period : null),
}

test('find_calculators describes matching calculators by their input keys', async () => {
  const found = await runChatTool('find_calculators', { query: 'orbital period' }, library)
  const [described] = JSON.parse(found.content)
  assert.equal(described.calculatorId, period.id)
  assert.deepEqual(
    described.inputs.map((i: { key: string }) => i.key),
    ['a', 'mu'],
  )
  const none = await runChatTool('find_calculators', { query: 'drag' }, library)
  assert.match(none.content, /No saved calculator matches/)
})

test('run_calculator computes with defaults for missing inputs and shows the run', async () => {
  const run = await runChatTool(
    'run_calculator',
    { calculatorId: period.id, inputs: [{ key: 'a', value: 42164 }] },
    library,
  )
  assert.equal(run.isError, undefined)
  assert.match(run.content, /Defaults were used for: mu/)
  assert.match(run.content, /T = 2 \* pi \* sqrt\(a\^3 \/ mu\) = .* = 86164 s/)
  assert.ok(run.widget?.kind === 'calculator')
  // The shown calculator starts from the values the AI used.
  assert.equal(run.widget.spec.inputs[0]?.default, 42164)
  assert.equal(run.widget.sourceCalculatorId, period.id)
})

test('run_calculator explains bad calls so Claude can retry', async () => {
  const unknownInput = await runChatTool(
    'run_calculator',
    { calculatorId: period.id, inputs: [{ key: 'r', value: 1 }] },
    library,
  )
  assert.equal(unknownInput.isError, true)
  assert.match(unknownInput.content, /The inputs are: a, mu/)
  const unknownId = await runChatTool('run_calculator', { calculatorId: 'nope', inputs: [] }, library)
  assert.equal(unknownId.isError, true)
  const failing = await runChatTool(
    'run_calculator',
    { calculatorId: period.id, inputs: [{ key: 'mu', value: 0 }] },
    library,
  )
  assert.equal(failing.isError, true)
  assert.equal((await runChatTool('delete_everything', {}, library)).isError, true)
})

test('photos count toward the history budget', () => {
  const photo = { mediaType: 'image/jpeg' as const, data: 'AAAA' }
  const turns: ChatTurn[] = [
    { role: 'user', content: 'old question', attachments: [photo, photo] },
    assistant('old answer'),
    { role: 'user', content: '', attachments: [photo] },
    assistant('new answer'),
  ]
  // Two photos do not fit next to the newer turns; a photo-only turn is kept.
  assert.deepEqual(boundHistory(turns, 10_000), [turns[2], turns[3]])
})

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
