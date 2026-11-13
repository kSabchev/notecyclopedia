import assert from 'node:assert/strict'
import { test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { callTool, fromSchema } from './ai-tool'
import type { createMessage } from './claude-client'

const tool: Anthropic.Tool = {
  name: 'answer',
  description: 'Return the answer.',
  input_schema: { type: 'object', properties: { n: { type: 'number' } } },
}

/** A stand-in for Claude that answers each request in turn; `null` is a reply without a tool call. */
function fakeClaude(replies: { input: unknown; stop?: string }[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = []
  const create = (async (request: Anthropic.MessageCreateParamsNonStreaming) => {
    requests.push(structuredClone(request))
    const reply = replies[requests.length - 1]
    assert.ok(reply, 'Claude was called more often than expected')
    return {
      model: 'claude-sonnet-5-5',
      stop_reason: reply.stop ?? 'tool_use',
      content:
        reply.input === null
          ? [{ type: 'text', text: 'No tool' }]
          : [{ type: 'tool_use', id: `call_${requests.length}`, name: 'answer', input: reply.input }],
    } as unknown as Anthropic.Message
  }) as typeof createMessage
  return { create, requests }
}

const parse = fromSchema(z.object({ n: z.number().int().positive() }))
const base = { feature: 'test', userId: 'user', tool, prompt: 'Give a number.', parse }

test('returns the checked answer of one call', async () => {
  const claude = fakeClaude([{ input: { n: 3 } }])
  const { value } = await callTool({ ...base, create: claude.create })
  assert.deepEqual(value, { n: 3 })
  assert.equal(claude.requests.length, 1)
  assert.equal(claude.requests[0]?.messages[0]?.content, 'Give a number.')
})

test('sends an invalid answer back once with what was wrong', async () => {
  const claude = fakeClaude([{ input: { n: -1 } }, { input: { n: 2 } }])
  const { value } = await callTool({ ...base, create: claude.create })
  assert.deepEqual(value, { n: 2 })
  const retry = JSON.stringify(claude.requests[1]?.messages.at(-1))
  assert.match(
    retry,
    /Invalid answer answer: n: Number must be greater than 0\. Call answer again with the fix\./,
  )
  assert.match(retry, /"is_error":true/)
})

test('gives up with a message the user can act on', async () => {
  const twice = fakeClaude([{ input: { n: -1 } }, { input: { n: -2 } }])
  await assert.rejects(
    callTool({ ...twice, ...base, create: twice.create, messages: { invalid: 'Bad plan.' } }),
    /Bad plan\./,
  )
  const once = fakeClaude([{ input: { n: -1 } }])
  await assert.rejects(callTool({ ...base, create: once.create, retries: 0 }), /invalid answer/)
  assert.equal(once.requests.length, 1, 'No retry when retries is 0')
  const cut = fakeClaude([{ input: null, stop: 'max_tokens' }])
  await assert.rejects(callTool({ ...base, create: cut.create }), /cut off at the AI output limit/)
  const none = fakeClaude([{ input: null }])
  await assert.rejects(callTool({ ...base, create: none.create }), /invalid answer/)
})
