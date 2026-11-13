import { once } from 'node:events'
import { type ServerResponse, createServer } from 'node:http'
import type { TestContext } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'

/** What the stand-in answers: text, tool calls, or both. */
export type FakeReply = {
  text?: string
  tools?: { name: string; input: unknown }[]
  usage?: { input_tokens: number; output_tokens: number }
}

/**
 * A local stand-in for the Anthropic Messages API, so integration tests run the real SDK, the usage log and the
 * budget check without calling Claude. Point the server at it with `env(fake)`. `reply` decides each answer from
 * the request; `requests` keeps every request, streamed (`stream: true`) or not.
 */
export async function fakeClaude(
  t: TestContext,
  reply: (request: Anthropic.MessageCreateParams, n: number) => FakeReply,
) {
  const requests: Anthropic.MessageCreateParams[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body) as Anthropic.MessageCreateParams
    requests.push(request)
    const answer = reply(request, requests.length)
    const usage = answer.usage ?? { input_tokens: 100, output_tokens: 20 }
    const content = [
      ...(answer.text ? [{ type: 'text', text: answer.text }] : []),
      ...(answer.tools ?? []).map((tool, i) => ({
        type: 'tool_use',
        id: `toolu_${requests.length}_${i}`,
        ...tool,
      })),
    ]
    const message = {
      id: `msg_${requests.length}`,
      type: 'message',
      role: 'assistant',
      model: request.model,
      content,
      stop_reason: answer.tools?.length ? 'tool_use' : 'end_turn',
      stop_sequence: null,
      usage,
    }
    if (request.stream) stream(res, message)
    else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(message))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No address')
  return { url: `http://127.0.0.1:${address.port}`, requests }
}

/** Server environment that sends the API's Claude calls to the stand-in. */
export const claudeEnv = (fake: { url: string }) => ({
  ANTHROPIC_API_KEY: 'test-key',
  ANTHROPIC_BASE_URL: fake.url,
})

/** The message as server-sent events, the way the API streams it: text in two pieces, tool input as JSON. */
function stream(
  res: ServerResponse,
  message: { content: ({ type: string; text?: string } & Record<string, unknown>)[]; usage: object } & Record<
    string,
    unknown
  >,
) {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const event = (type: string, data: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  event('message_start', {
    message: { ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 1 } },
  })
  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      const text = block.text ?? ''
      const half = Math.ceil(text.length / 2)
      event('content_block_start', { index, content_block: { type: 'text', text: '' } })
      for (const piece of [text.slice(0, half), text.slice(half)])
        event('content_block_delta', { index, delta: { type: 'text_delta', text: piece } })
    } else {
      const { input, ...start } = block
      event('content_block_start', { index, content_block: { ...start, input: {} } })
      event('content_block_delta', {
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
      })
    }
    event('content_block_stop', { index })
  })
  event('message_delta', {
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: message.usage,
  })
  event('message_stop', {})
  res.end()
}
