import { fileSlug, isCalendarDate, planFileSchema } from '@nc/shared'
import { eq } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { assertCourse } from '../access'
import { db, schema } from '../db'
import { HttpError, localeInput, me, param, sendAs } from '../http'
import { today } from '../services/daily-question'
import { generateExamPlan } from '../services/study/exam-plan'
import {
  acceptShare,
  declineShare,
  exportPlan,
  importPlan,
  listShares,
  sharePlan,
} from '../services/study/plan-sharing'
import {
  listPlans,
  loadPlan,
  planEditSchema,
  savePlan,
  setPlanActive,
  setTaskDone,
  todaysTasks,
} from '../services/study/plans'
import { whereWasI } from '../services/study/where-was-i'

/** The study companion: where you left off, and revision plans for exams. */
export const study = Router()

const timeZoneOf = (user: ReturnType<typeof me>) => (user as { timezone?: string | null }).timezone

study.get('/where', async (req, res) => {
  res.json(await whereWasI(me(req).id))
})

study.get('/today', async (req, res) => {
  const user = me(req)
  const day = today(timeZoneOf(user))
  res.json({ today: day, plans: await todaysTasks(user.id, day) })
})

study.get('/plans', async (req, res) => {
  res.json(await listPlans(me(req).id))
})

/** Propose a revision plan in one Claude call and save it; it is edited afterwards with PUT. */
study.post('/plans', async (req, res) => {
  const body = z
    .object({
      courseId: z.string().uuid(),
      examDate: z.string().refine(isCalendarDate, 'Expected a date (YYYY-MM-DD)'),
      minutesPerDay: z.number().int().min(15).max(600).default(60),
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
      /** The exam's scope, with how well each page is known; all pages when left out. */
      pages: z
        .array(
          z.object({
            id: z.string().uuid(),
            confidence: z.enum(['know', 'shaky', 'new']).nullable().optional(),
          }),
        )
        .max(200)
        .optional(),
      note: z.string().trim().max(500).optional(),
      locale: localeInput,
    })
    .parse(req.body)
  const user = me(req)
  await assertCourse(body.courseId, user.id)
  const [course] = await db
    .select({ name: schema.courses.name })
    .from(schema.courses)
    .where(eq(schema.courses.id, body.courseId))
  const plan = await generateExamPlan({
    ...body,
    note: body.note || undefined,
    userId: user.id,
    courseName: course?.name ?? '',
    today: today(timeZoneOf(user)),
  })
  res.status(201).json(plan)
})

study.get('/plans/:id', async (req, res) => {
  const plans = await listPlans(me(req).id)
  const plan = plans.find((p) => p.id === param(req, 'id'))
  if (!plan) throw new HttpError(404, 'Plan not found')
  res.json(plan)
})

study.put('/plans/:id', async (req, res) => {
  const edit = planEditSchema.parse(req.body)
  if (!isCalendarDate(edit.examDate) || edit.days.some((d) => !isCalendarDate(d.date)))
    throw new HttpError(400, 'Invalid date')
  res.json(await savePlan(param(req, 'id'), me(req).id, edit))
})

study.patch('/plans/:id/items/:itemId', async (req, res) => {
  const { done } = z.object({ done: z.boolean() }).parse(req.body)
  res.json(await setTaskDone(param(req, 'id'), me(req).id, param(req, 'itemId'), done))
})

/** Pause or resume a plan; a paused plan is kept as it is. */
study.patch('/plans/:id', async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body)
  res.json(await setPlanActive(param(req, 'id'), me(req).id, active))
})

/** The plan as a JSON file, to keep or to import elsewhere. */
study.get('/plans/:id/export', async (req, res) => {
  const file = await exportPlan(param(req, 'id'), me(req).id)
  sendAs(res, `${fileSlug(file.title, 'plan')}.plan.json`)
  res.json(file)
})

/** A plan from an exported file, into one of the user's courses; tasks are linked to its pages. */
study.post('/plans/import', async (req, res) => {
  const body = z
    .object({ courseId: z.string().uuid(), plan: planFileSchema, keepProgress: z.boolean().default(false) })
    .parse(req.body)
  const user = me(req)
  await assertCourse(body.courseId, user.id)
  res.status(201).json(await importPlan(user.id, body.courseId, body.plan, body.keepProgress))
})

/** Send a copy of the plan to another member of its course. */
study.post('/plans/:id/share', async (req, res) => {
  const { userId } = z.object({ userId: z.string().min(1).max(100) }).parse(req.body)
  res.status(201).json(await sharePlan(param(req, 'id'), me(req).id, userId))
})

study.get('/shares', async (req, res) => {
  res.json(await listShares(me(req).id))
})

study.post('/shares/:id/accept', async (req, res) => {
  res.status(201).json(await acceptShare(param(req, 'id'), me(req).id))
})

study.delete('/shares/:id', async (req, res) => {
  await declineShare(param(req, 'id'), me(req).id)
  res.status(204).end()
})

study.delete('/plans/:id', async (req, res) => {
  const plan = await loadPlan(param(req, 'id'), me(req).id)
  await db.delete(schema.examPlans).where(eq(schema.examPlans.id, plan.id))
  res.status(204).end()
})
