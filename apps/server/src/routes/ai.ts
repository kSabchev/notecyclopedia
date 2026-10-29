import type { AiCitation, AiStreamEvent, CalculatorSpec, WidgetAttrs } from '@nc/shared'
import { and, asc, desc, eq } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { loadPage } from '../access'
import { db, schema } from '../db'
import { HttpError, me, notFound, param } from '../http'
import { aiConfigured, generateCalculator, streamAnswer, threadTitle } from '../services/claude'
import { assertAiBudget } from '../services/claude-usage'
import { generatePageReview } from '../services/page-review'
import { type RetrievedChunk, retrieve } from '../services/retrieval'

export const ai = Router()

ai.get('/status', (_req, res) => {
  res.json({ configured: aiConfigured() })
})

ai.post('/pages/:id/review', async (req, res) => {
  const user = me(req)
  const page = await loadPage(param(req, 'id'), user.id, 'editor')
  const review = await generatePageReview(page.title, page.content, user.id)
  const { contentText: _omit, ...pageData } = page
  res.json({ page: pageData, review })
})

ai.get('/threads', async (req, res) => {
  const rows = await db
    .select({
      id: schema.aiThreads.id,
      title: schema.aiThreads.title,
      mode: schema.aiThreads.mode,
      updatedAt: schema.aiThreads.updatedAt,
    })
    .from(schema.aiThreads)
    .where(eq(schema.aiThreads.userId, me(req).id))
    .orderBy(desc(schema.aiThreads.updatedAt))
    .limit(50)
  res.json(rows)
})

async function loadThread(id: string, userId: string) {
  const [t] = await db
    .select()
    .from(schema.aiThreads)
    .where(and(eq(schema.aiThreads.id, id), eq(schema.aiThreads.userId, userId)))
  if (!t) throw notFound('Session not found')
  return t
}

ai.get('/threads/:id', async (req, res) => {
  const thread = await loadThread(param(req, 'id'), me(req).id)
  const messages = await db
    .select()
    .from(schema.aiMessages)
    .where(eq(schema.aiMessages.threadId, thread.id))
    .orderBy(asc(schema.aiMessages.createdAt))
  res.json({ thread, messages })
})

ai.delete('/threads/:id', async (req, res) => {
  const thread = await loadThread(param(req, 'id'), me(req).id)
  await db.delete(schema.aiThreads).where(eq(schema.aiThreads.id, thread.id))
  res.status(204).end()
})

const chatInput = z.object({
  threadId: z.string().uuid().optional(),
  mode: z.enum(['ask', 'summarize', 'solve', 'calculator']),
  message: z.string().trim().min(1).max(20000),
  /** Limit retrieval to these courses (default: all the user's courses). */
  courseIds: z.array(z.string().uuid()).max(50).optional(),
  /** Use these pages verbatim as sources (e.g. "summarize this page"). */
  pageIds: z.array(z.string().uuid()).max(10).optional(),
})

/** Streams the answer as server-sent events (see AiStreamEvent in @nc/shared). */
ai.post('/chat', async (req, res) => {
  const body = chatInput.parse(req.body)
  const user = me(req)
  if (!aiConfigured()) throw new HttpError(503, 'AI is not configured. Add ANTHROPIC_API_KEY to .env')
  // Checked again per Claude call; here so the error arrives as a status code rather than mid-stream.
  await assertAiBudget(user.id)

  const thread = body.threadId
    ? await loadThread(body.threadId, user.id)
    : (
        await db
          .insert(schema.aiThreads)
          .values({ userId: user.id, title: threadTitle(body.message), mode: body.mode })
          .returning()
      )[0]
  if (!thread) throw new Error('thread insert failed')

  const previous = await db
    .select({ role: schema.aiMessages.role, content: schema.aiMessages.content })
    .from(schema.aiMessages)
    .where(eq(schema.aiMessages.threadId, thread.id))
    .orderBy(asc(schema.aiMessages.createdAt))

  // Sources: explicit pages, otherwise retrieval over the user's notes.
  let sources: RetrievedChunk[]
  if (body.pageIds?.length) {
    sources = []
    for (const id of body.pageIds) {
      const p = await loadPage(id, user.id)
      sources.push({
        sourceType: 'page',
        sourceId: p.id,
        title: p.title,
        text: p.contentText.slice(0, 40000),
      })
    }
  } else {
    sources = await retrieve(body.message, user.id, { courseIds: body.courseIds })
  }
  const citations: AiCitation[] = []
  for (const s of sources)
    if (!citations.some((c) => c.sourceId === s.sourceId))
      citations.push({ sourceType: s.sourceType, sourceId: s.sourceId, title: s.title })

  await db.insert(schema.aiMessages).values({ threadId: thread.id, role: 'user', content: body.message })

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  const send = (ev: AiStreamEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`)
  let aborted = false
  req.on('close', () => {
    aborted = true
  })

  send({ type: 'thread', threadId: thread.id })
  send({ type: 'citations', citations })

  let answer = ''
  let calculator: CalculatorSpec | null = null
  const widgets: WidgetAttrs[] = []
  try {
    for await (const ev of streamAnswer(
      body.mode,
      [...previous, { role: 'user', content: body.message }],
      sources,
      user.id,
    )) {
      if (aborted) break
      if ('widget' in ev) {
        widgets.push(ev.widget)
        send({ type: 'widget', widget: ev.widget })
      } else {
        answer += ev.text
        send({ type: 'text', text: ev.text })
      }
    }
    if (!aborted && (body.mode === 'solve' || body.mode === 'calculator')) {
      try {
        calculator = await generateCalculator(`Problem:\n${body.message}\n\nSolution:\n${answer}`, user.id)
        send({ type: 'calculator', spec: calculator })
      } catch (e) {
        send({ type: 'error', message: `Calculator: ${(e as Error).message}` })
      }
    }
  } catch (e) {
    console.error('[ai]', e)
    send({ type: 'error', message: (e as Error).message })
  }

  const [msg] = await db
    .insert(schema.aiMessages)
    .values({ threadId: thread.id, role: 'assistant', content: answer, citations, calculator, widgets })
    .returning({ id: schema.aiMessages.id })
  await db.update(schema.aiThreads).set({ updatedAt: new Date() }).where(eq(schema.aiThreads.id, thread.id))
  send({ type: 'done', messageId: msg?.id ?? '' })
  res.end()
})

/** Build a calculator from a description or a solved problem, without chatting. */
ai.post('/calculator', async (req, res) => {
  const { context } = z.object({ context: z.string().trim().min(3).max(20000) }).parse(req.body)
  res.json(await generateCalculator(context, me(req).id))
})
