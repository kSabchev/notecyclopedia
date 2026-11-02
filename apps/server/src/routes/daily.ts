import { Router } from 'express'
import { z } from 'zod'
import { loadPage } from '../access'
import { me, param } from '../http'
import {
  expandDailyQuestion,
  generateDailyQuestion,
  listQuestions,
  loadDailyQuestion,
  questionBlocks,
  questionForDay,
  today,
} from '../services/daily-question'
import { saveRevision } from './pages'

/** The daily question: made only on request, at most once a day per user (see services/daily-question). */
export const daily = Router()

const timeZoneOf = (user: ReturnType<typeof me>) => (user as { timezone?: string | null }).timezone

daily.get('/today', async (req, res) => {
  const user = me(req)
  const day = today(timeZoneOf(user))
  res.json({ day, question: await questionForDay(user.id, day) })
})

/** The reader's interface language: the fallback when the notes are too short to tell. */
const locale = z.enum(['en', 'bg']).optional()

daily.post('/today', async (req, res) => {
  const body = z.object({ courseId: z.string().uuid().optional(), locale }).parse(req.body ?? {})
  const user = me(req)
  res.json(await generateDailyQuestion(user.id, today(timeZoneOf(user)), body))
})

/** A question on demand, at any time: in addition to today's question, avoiding repeats. */
daily.post('/', async (req, res) => {
  const body = z.object({ courseId: z.string().uuid().optional(), locale }).parse(req.body ?? {})
  const user = me(req)
  res
    .status(201)
    .json(await generateDailyQuestion(user.id, today(timeZoneOf(user)), { ...body, onDemand: true }))
})

/** All the user's questions, newest first, a page at a time. */
daily.get('/', async (req, res) => {
  const query = z
    .object({
      courseId: z.string().uuid().optional(),
      q: z.string().trim().max(200).optional(),
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
    })
    .parse(req.query)
  res.json(await listQuestions(me(req).id, { ...query, q: query.q || undefined, limit: 30 }))
})

daily.post('/:id/expand', async (req, res) => {
  const body = z.object({ kind: z.enum(['story', 'advanced']), locale }).parse(req.body)
  const user = me(req)
  const question = await loadDailyQuestion(param(req, 'id'), user.id)
  res.json(await expandDailyQuestion(question, body.kind, user.id, body.locale))
})

/** Append the question, its answer and expansions to the page it is about, as a new revision. */
daily.post('/:id/save', async (req, res) => {
  const labels = z
    .object({
      question: z.string().trim().min(1).max(60),
      answer: z.string().trim().min(1).max(60),
      story: z.string().trim().min(1).max(60),
      advanced: z.string().trim().min(1).max(60),
    })
    .parse(req.body?.labels)
  const user = me(req)
  const question = await loadDailyQuestion(param(req, 'id'), user.id)
  if (!question.pageId) return res.status(404).json({ error: 'The page of this question was deleted' })
  const page = await loadPage(question.pageId, user.id, 'editor')
  await saveRevision(
    page,
    page.revision,
    {
      title: page.title,
      type: page.type,
      lectureNumber: page.lectureNumber,
      tags: page.tags,
      aiVisible: page.aiVisible,
      content: {
        ...page.content,
        content: [...(page.content.content ?? []), ...questionBlocks(question, labels)],
      },
    },
    { userId: user.id, message: `${labels.question}: ${question.topic}` },
  )
  res.json({ pageId: page.id })
})
