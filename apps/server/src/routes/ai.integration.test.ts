import assert from 'node:assert/strict'
import { test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import type { AiStreamEvent } from '@nc/shared'
import { startTestApi } from '../testing/api'
import { type FakeReply, claudeEnv, fakeClaude } from '../testing/claude'
import { testDatabaseUrl } from '../testing/database'

/** The events of a streamed answer. */
async function events(response: Response): Promise<AiStreamEvent[]> {
  assert.equal(response.status, 200, await response.clone().text())
  return (await response.text())
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice(6)) as AiStreamEvent)
}
const textOf = (evs: AiStreamEvent[]) => evs.map((e) => (e.type === 'text' ? e.text : '')).join('')
const lastContent = (request: Anthropic.MessageCreateParams) =>
  JSON.stringify(request.messages.at(-1)?.content)

const speedSpec = {
  name: 'Circular speed',
  inputs: [{ key: 'r', label: 'Radius', unit: 'km', default: 7000 }],
  constants: { mu: 398600.4418 },
  constantMetadata: { mu: { name: 'Gravitational parameter', symbol: 'μ', unit: 'km^3/s^2' } },
  outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / r)' }],
}

test(
  'AI routes against a stand-in for Claude: chat, sessions, tools, calculators, checks and the budget',
  {
    skip: !testDatabaseUrl,
    timeout: 120_000,
  },
  async (t) => {
    if (!testDatabaseUrl) return
    // Each request is answered by its feature: chat calls a tool first, then answers; the others call their tool.
    const fake = await fakeClaude(t, (request): FakeReply => {
      const tools = (request.tools ?? []).map((tool) => ('name' in tool ? tool.name : ''))
      const answered = lastContent(request).includes('tool_result')
      if (tools.includes('find_calculators')) {
        if (!answered && lastContent(request).includes('Which calculator'))
          return { tools: [{ name: 'find_calculators', input: { query: 'circular speed' } }] }
        return { text: 'A Hohmann transfer uses two burns between circular orbits.' }
      }
      if (tools.includes('save_calculator'))
        return answered ? { text: 'Saved.' } : { tools: [{ name: 'save_calculator', input: speedSpec }] }
      if (tools.includes('quick_check'))
        return {
          tools: [
            {
              name: 'quick_check',
              input: { questions: [{ question: 'Why two burns?', answer: 'One to leave, one to arrive.' }] },
            },
          ],
        }
      if (tools.includes('review_calculator'))
        return { tools: [{ name: 'review_calculator', input: { findings: [] } }] }
      throw new Error(`Unexpected request with tools ${tools.join(', ')}`)
    })
    const api = await startTestApi(t, testDatabaseUrl, {
      env: { ...claudeEnv(fake), AI_DAILY_TOKEN_LIMIT: '1000000' },
    })
    const { db, schema, request, send, ok } = api
    const { eq } = api.orm
    const student = await api.signup('student')
    const outsider = await api.signup('outsider')
    const course = await api.createCourse(student, 'Astrodynamics')
    const lecture = await api.createPage(student, {
      courseId: course.id,
      title: 'Orbital transfers',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'A Hohmann transfer uses two burns.' }] },
      ],
    })
    const myCalc = await api.createCalculator(student, 'Circular speed')
    const chat = (body: Record<string, unknown>, actor = student) => send(actor, 'POST', '/ai/chat', body)

    await t.test('the status says AI is configured', async () => {
      assert.deepEqual(await ok(request(student, '/ai/status')), { configured: true })
    })

    await t.test('a message needs text or a photo, and photos must be base64 images', async () => {
      assert.equal((await chat({ mode: 'tutor', message: '' })).status, 400)
      const photo = (data: string, mediaType = 'image/jpeg') => ({ mediaType, data })
      assert.equal(
        (await chat({ mode: 'check', message: '', attachments: [photo('not base64!')] })).status,
        400,
      )
      assert.equal(
        (await chat({ mode: 'check', message: '', attachments: [photo('AAAA', 'image/bmp')] })).status,
        400,
      )
      assert.equal((await chat({ mode: 'nope', message: 'Hi' })).status, 400)
    })

    let threadId = ''
    let answerId = ''
    await t.test('an answer streams with its sources, usage and a saved session', async () => {
      const before = fake.requests.length
      const evs = await events(await chat({ mode: 'ask', message: 'What is a Hohmann transfer?' }))
      assert.deepEqual(
        evs.map((e) => e.type),
        ['thread', 'citations', 'text', 'text', 'usage', 'done'],
      )
      const thread = evs[0]?.type === 'thread' ? evs[0] : null
      const cited = evs[1]?.type === 'citations' ? evs[1].citations : []
      const done = evs.at(-1)?.type === 'done' ? evs.at(-1) : null
      assert.ok(thread && done?.type === 'done')
      threadId = thread.threadId
      answerId = done.messageId
      assert.deepEqual(
        cited.map((c) => c.sourceId),
        [lecture.id],
        'Retrieved from the student’s own notes',
      )
      assert.equal(textOf(evs), 'A Hohmann transfer uses two burns between circular orbits.')
      const sent = fake.requests[before]
      assert.ok(sent?.stream, 'Chat answers are streamed')
      assert.match(lastContent(sent), /<sources>.*Hohmann transfer uses two burns/s)

      const sessions = await ok<{ id: string; title: string; mode: string }[]>(
        request(student, '/ai/threads'),
      )
      assert.deepEqual(
        sessions.map((s) => [s.id, s.mode]),
        [[threadId, 'ask']],
      )
      const saved = await ok<{ messages: { role: string; content: string; usage: unknown }[] }>(
        request(student, `/ai/threads/${threadId}`),
      )
      assert.deepEqual(
        saved.messages.map((m) => m.role),
        ['user', 'assistant'],
      )
      assert.ok(saved.messages[1]?.usage, 'The answer keeps its cost')
      assert.equal((await request(outsider, `/ai/threads/${threadId}`)).status, 404)
      assert.deepEqual(await ok(request(outsider, '/ai/threads')), [])

      const logged = await db
        .select({ operation: schema.claudeApiCalls.operation, status: schema.claudeApiCalls.status })
        .from(schema.claudeApiCalls)
        .where(eq(schema.claudeApiCalls.userId, student.id))
      assert.deepEqual(logged, [{ operation: 'chat', status: 'succeeded' }], 'Every call is in the usage log')
    })

    await t.test('a follow-up continues the session, and Claude may use the calculator tools', async () => {
      const before = fake.requests.length
      const evs = await events(await chat({ mode: 'tutor', message: 'Which calculator fits?', threadId }))
      assert.equal(evs[0]?.type === 'thread' && evs[0].threadId, threadId)
      const [first, second] = fake.requests.slice(before)
      assert.equal(first?.messages.length, 3, 'The earlier question and answer go along')
      assert.match(lastContent(second as Anthropic.MessageCreateParams), new RegExp(myCalc.id))
      assert.equal(fake.requests.length - before, 2, 'One tool round, then the answer')
      assert.equal((await chat({ mode: 'ask', message: 'Hi', threadId }, outsider)).status, 404)
    })

    await t.test('"Build calculator" answers with calculators, also on request for an answer', async () => {
      const evs = await events(await chat({ mode: 'calculator', message: 'Circular orbit speed' }))
      const made = evs.flatMap((e) => (e.type === 'calculator' ? [e.spec.name] : []))
      assert.deepEqual(made, ['Circular speed'])

      const built = await ok<{ calculators: { name: string }[] }>(
        send(student, 'POST', '/ai/calculator', { context: 'Circular orbit speed', messageId: answerId }),
      )
      assert.deepEqual(
        built.calculators.map((c) => c.name),
        ['Circular speed'],
      )
      const [stored] = await db
        .select({ calculators: schema.aiMessages.calculators })
        .from(schema.aiMessages)
        .where(eq(schema.aiMessages.id, answerId))
      assert.deepEqual(
        stored?.calculators.map((c) => c.name),
        ['Circular speed'],
        'Kept with the answer',
      )
      assert.equal(
        (await send(outsider, 'POST', '/ai/calculator', { context: 'Speed', messageId: answerId })).status,
        404,
      )
    })

    await t.test('a quick check is made once and kept with the answer', async () => {
      const asked = () => send(student, 'POST', `/ai/messages/${answerId}/quick-check`, {})
      const check = await ok<{ questions: { question: string }[] }>(asked())
      assert.deepEqual(
        check.questions.map((q) => q.question),
        ['Why two burns?'],
      )
      const calls = fake.requests.length
      assert.deepEqual(await ok(asked()), check)
      assert.equal(fake.requests.length, calls, 'Asking again does not call Claude')
      assert.equal((await send(outsider, 'POST', `/ai/messages/${answerId}/quick-check`, {})).status, 404)
    })

    await t.test('calculator checks and rework: only your own', async () => {
      const review = await ok<{ findings: unknown[] }>(
        send(student, 'POST', `/ai/calculators/${myCalc.id}/review`, { locale: 'en' }),
      )
      assert.deepEqual(review.findings, [])
      assert.equal((await send(outsider, 'POST', `/ai/calculators/${myCalc.id}/review`, {})).status, 404)
      assert.equal(
        (await send(student, 'POST', `/ai/calculators/${myCalc.id}/rework`, { instructions: '' })).status,
        400,
      )
      assert.equal(
        (await send(outsider, 'POST', `/ai/calculators/${myCalc.id}/rework`, { instructions: 'Solve for r' }))
          .status,
        404,
      )
    })

    await t.test('topic hubs are drafted by editors of the course', async () => {
      await api.addMember(student, course.id, outsider, 'viewer')
      const draft = (actor: typeof student) =>
        send(actor, 'POST', '/ai/topic-hub', { courseId: course.id, topic: 'Hohmann transfer' })
      assert.equal((await draft(outsider)).status, 403)
    })

    await t.test('the daily budget stops a user before the answer starts', async () => {
      const spender = await api.signup('spender')
      await db.insert(schema.claudeApiCalls).values({
        userId: spender.id,
        operation: 'chat',
        model: 'claude-sonnet-5-5',
        request: {},
        status: 'succeeded',
        inputTokens: 2_000_000,
        outputTokens: 0,
      })
      const calls = fake.requests.length
      assert.equal((await chat({ mode: 'ask', message: 'One more?' }, spender)).status, 429)
      assert.equal(fake.requests.length, calls, 'Claude is not called')
    })

    await t.test('deleting a session', async () => {
      assert.equal((await request(outsider, `/ai/threads/${threadId}`, { method: 'DELETE' })).status, 404)
      assert.equal((await request(student, `/ai/threads/${threadId}`, { method: 'DELETE' })).status, 204)
      assert.equal((await request(student, `/ai/threads/${threadId}`)).status, 404)
    })
  },
)
