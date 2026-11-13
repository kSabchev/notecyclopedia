import assert from 'node:assert/strict'
import { test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { type ChatTurn, boundHistory, streamAnswer } from './chat'
import { type CalculatorLibrary, type LibraryCalculator, orbitFromTool, runChatTool } from './chat-tools'

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

test('a chat answer the reader stops reading closes the Claude stream', async () => {
  let sent = 0
  let closed = false
  // Stands in for the streamed Claude call: it would write a long answer.
  const stream = async function* () {
    try {
      for (let i = 0; i < 1000; i++) {
        sent++
        yield `word${i} `
      }
      return { stop_reason: 'end_turn', content: [] } as unknown as Anthropic.Message
    } finally {
      closed = true
    }
  } as never
  const answer = streamAnswer({
    mode: 'ask',
    history: [{ role: 'user', content: 'Why two burns?' }],
    sources: [],
    userId: 'reader',
    calculators: {} as CalculatorLibrary,
    stream,
  })
  let read = 0
  for await (const _ of answer) if (++read === 3) break // the browser went away
  assert.equal(closed, true, 'The Claude stream is closed')
  assert.ok(sent <= 4, `Claude stopped after ${sent} chunks`)
})
