import {
  AI_MODES,
  type AiCitation,
  type AiStreamEvent,
  type CalculatorSpec,
  type WidgetAttrs,
} from '@nc/shared'
import { and, asc, desc, eq } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { loadPage } from '../access'
import { db, schema } from '../db'
import { HttpError, me, notFound, param } from '../http'
import { calculatorLibrary } from '../services/calculator-library'
import { reviewCalculator } from '../services/calculator-review'
import { aiConfigured, generateCalculators, streamAnswer, threadTitle } from '../services/claude'
import { UsageMeter } from '../services/claude-client'
import { assertAiBudget } from '../services/claude-usage'
import { generatePageReview } from '../services/page-review'
import { type RetrievedChunk, retrieve } from '../services/retrieval'
import { loadCalc } from './calculators'

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

/** Check a calculator's formulas and propose corrections; nothing is saved (see CalculatorReview). */
ai.post('/calculators/:id/review', async (req, res) => {
  const user = me(req)
  const calc = await loadCalc(param(req, 'id'), user.id)
  res.json(await reviewCalculator(calc.spec, user.id))
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

/** Photos are downscaled in the browser; this caps one at about 1.5 MB. */
const attachmentInput = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  data: z
    .string()
    .min(1)
    .max(1_500_000)
    .regex(/^[A-Za-z0-9+/]+=*$/, 'Not base64'),
})

const chatInput = z
  .object({
    threadId: z.string().uuid().optional(),
    mode: z.enum(AI_MODES),
    message: z.string().trim().max(20000),
    /** Photos, e.g. handwritten working to check. */
    attachments: z.array(attachmentInput).max(3).default([]),
    /** Limit retrieval to these courses (default: all the user's courses). */
    courseIds: z.array(z.string().uuid()).max(50).optional(),
    /** Use these pages verbatim as sources (e.g. "summarize this page"). */
    pageIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .refine((b) => b.message || b.attachments.length, { message: 'Write a message or attach a photo' })

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
          .values({ userId: user.id, title: threadTitle(body.message || 'Photo'), mode: body.mode })
          .returning()
      )[0]
  if (!thread) throw new Error('thread insert failed')

  const previous = await db
    .select({
      role: schema.aiMessages.role,
      content: schema.aiMessages.content,
      attachments: schema.aiMessages.attachments,
    })
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
    sources = body.message ? await retrieve(body.message, user.id, { courseIds: body.courseIds }) : []
  }
  const citations: AiCitation[] = []
  for (const s of sources)
    if (!citations.some((c) => c.sourceId === s.sourceId))
      citations.push({ sourceType: s.sourceType, sourceId: s.sourceId, title: s.title })

  await db.insert(schema.aiMessages).values({
    threadId: thread.id,
    role: 'user',
    content: body.message,
    attachments: body.attachments,
  })

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
  let calculators: CalculatorSpec[] = []
  const widgets: WidgetAttrs[] = []
  const meter = new UsageMeter()
  try {
    for await (const ev of streamAnswer({
      mode: body.mode,
      history: [...previous, { role: 'user', content: body.message, attachments: body.attachments }],
      sources,
      userId: user.id,
      calculators: calculatorLibrary(user.id),
      meter,
    })) {
      if (aborted) break
      if ('widget' in ev) {
        widgets.push(ev.widget)
        send({ type: 'widget', widget: ev.widget })
      } else {
        answer += ev.text
        send({ type: 'text', text: ev.text })
      }
    }
    // Only "Build calculator" makes one automatically; after other answers it is a button, so it costs only on request.
    if (!aborted && body.mode === 'calculator') {
      try {
        const made = await generateCalculators(
          `Request:\n${body.message}\n\nExplanation:\n${answer}`,
          user.id,
          meter,
        )
        calculators = made.calculators
        for (const spec of calculators) send({ type: 'calculator', spec })
        for (const failure of made.failed) send({ type: 'error', message: `Calculator: ${failure}` })
      } catch (e) {
        send({ type: 'error', message: `Calculator: ${(e as Error).message}` })
      }
    }
  } catch (e) {
    console.error('[ai]', e)
    send({ type: 'error', message: (e as Error).message })
  }

  const usage = meter.total()
  if (usage) send({ type: 'usage', usage })
  const [msg] = await db
    .insert(schema.aiMessages)
    .values({
      threadId: thread.id,
      role: 'assistant',
      content: answer,
      citations,
      calculators,
      widgets,
      usage,
    })
    .returning({ id: schema.aiMessages.id })
  await db.update(schema.aiThreads).set({ updatedAt: new Date() }).where(eq(schema.aiThreads.id, thread.id))
  send({ type: 'done', messageId: msg?.id ?? '' })
  res.end()
})

/**
 * Build calculators from a description or a solved problem, without chatting. With `messageId` (an answer in
 * one of the user's sessions) they are also stored with that answer.
 */
ai.post('/calculator', async (req, res) => {
  const { context, messageId } = z
    .object({ context: z.string().trim().min(3).max(20000), messageId: z.string().uuid().optional() })
    .parse(req.body)
  const user = me(req)
  const [message] = messageId
    ? await db
        .select({ id: schema.aiMessages.id, calculators: schema.aiMessages.calculators })
        .from(schema.aiMessages)
        .innerJoin(schema.aiThreads, eq(schema.aiThreads.id, schema.aiMessages.threadId))
        .where(
          and(
            eq(schema.aiMessages.id, messageId),
            eq(schema.aiThreads.userId, user.id),
            eq(schema.aiMessages.role, 'assistant'),
          ),
        )
    : []
  if (messageId && !message) throw notFound('Answer not found')
  const made = await generateCalculators(context, user.id)
  if (message)
    await db
      .update(schema.aiMessages)
      .set({ calculators: [...message.calculators, ...made.calculators] })
      .where(eq(schema.aiMessages.id, message.id))
  res.json(made)
})
