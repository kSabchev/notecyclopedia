import { type ExamPlan, overdueTasks } from '@nc/shared'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { memberCourseIds } from '../../access'
import { db, schema } from '../../db'
import { HttpError } from '../../http'

/** Revision plans as stored: listing, loading, editing, ticking tasks off, pausing. */

/** The furthest exam a plan is made for. */
export const MAX_PLAN_DAYS = 90

export const toPlan = (row: typeof schema.examPlans.$inferSelect): ExamPlan => ({
  id: row.id,
  courseId: row.courseId,
  title: row.title,
  examDate: row.examDate,
  studyWeekdays: row.studyWeekdays,
  active: row.active,
  days: row.days,
  usage: row.usage ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

export async function listPlans(userId: string): Promise<ExamPlan[]> {
  const ids = await memberCourseIds(userId)
  if (!ids.length) return []
  const rows = await db
    .select()
    .from(schema.examPlans)
    .where(and(eq(schema.examPlans.userId, userId), inArray(schema.examPlans.courseId, ids)))
    .orderBy(asc(schema.examPlans.examDate))
  return rows.map(toPlan)
}

export async function loadPlan(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(schema.examPlans)
    .where(and(eq(schema.examPlans.id, id), eq(schema.examPlans.userId, userId)))
  if (!row) throw new HttpError(404, 'Plan not found')
  return row
}

export const planEditSchema = z.object({
  title: z.string().trim().min(1).max(120),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        items: z
          .array(
            z.object({
              id: z.string().uuid(),
              pageId: z.string().uuid().nullable(),
              pageTitle: z.string().max(200).nullable(),
              focus: z.string().trim().min(1).max(300),
              done: z.boolean(),
              lectureNumber: z.number().int().positive().max(2_147_483_647).nullable().optional(),
              calculatorIds: z.array(z.string().uuid()).max(10).optional(),
            }),
          )
          .max(30),
      }),
    )
    .max(MAX_PLAN_DAYS * 2),
})

/** Save the user's edits. Page links must stay inside the plan's course; others lose their link. */
export async function savePlan(id: string, userId: string, edit: z.infer<typeof planEditSchema>) {
  const plan = await loadPlan(id, userId)
  const linked = [
    ...new Set(edit.days.flatMap((d) => d.items.map((i) => i.pageId).filter((p) => p !== null))),
  ]
  const inCourse = linked.length
    ? new Map(
        (
          await db
            .select({ id: schema.pages.id, title: schema.pages.title })
            .from(schema.pages)
            .where(and(eq(schema.pages.courseId, plan.courseId), inArray(schema.pages.id, linked)))
        ).map((p) => [p.id, p.title]),
      )
    : new Map<string, string>()
  // Calculators are personal: a task links only to the user's own.
  const wanted = [...new Set(edit.days.flatMap((d) => d.items.flatMap((i) => i.calculatorIds ?? [])))]
  const own = new Set(
    wanted.length
      ? (
          await db
            .select({ id: schema.calculators.id })
            .from(schema.calculators)
            .where(and(eq(schema.calculators.ownerId, userId), inArray(schema.calculators.id, wanted)))
        ).map((c) => c.id)
      : [],
  )
  const days = [...edit.days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      items: d.items.map(({ calculatorIds, lectureNumber, ...i }) => {
        const title = i.pageId ? inCourse.get(i.pageId) : undefined
        const calculators = (calculatorIds ?? []).filter((id) => own.has(id))
        return {
          ...i,
          pageId: title ? i.pageId : null,
          pageTitle: title ?? (i.pageId ? null : i.pageTitle),
          ...(lectureNumber != null && { lectureNumber }),
          ...(calculators.length > 0 && { calculatorIds: calculators }),
        }
      }),
    }))
  const [row] = await db
    .update(schema.examPlans)
    .set({ title: edit.title, examDate: edit.examDate, days, updatedAt: new Date() })
    .where(eq(schema.examPlans.id, plan.id))
    .returning()
  if (!row) throw new HttpError(404, 'Plan not found')
  return toPlan(row)
}

/** Tick a task off (or back on) without sending the whole plan, e.g. from the home page. */
export async function setTaskDone(planId: string, userId: string, itemId: string, done: boolean) {
  const plan = await loadPlan(planId, userId)
  let found = false
  const days = plan.days.map((d) => ({
    ...d,
    items: d.items.map((i) => {
      if (i.id !== itemId) return i
      found = true
      return { ...i, done }
    }),
  }))
  if (!found) throw new HttpError(404, 'Task not found')
  const [row] = await db
    .update(schema.examPlans)
    .set({ days, updatedAt: new Date() })
    .where(eq(schema.examPlans.id, plan.id))
    .returning()
  if (!row) throw new HttpError(404, 'Plan not found')
  return toPlan(row)
}

/** Today's tasks of each plan whose exam is still ahead (or today), for the home page. */
export async function todaysTasks(userId: string, today: string) {
  const plans = await listPlans(userId)
  return plans
    .filter((p) => p.active && p.examDate >= today)
    .map((p) => ({
      planId: p.id,
      title: p.title,
      examDate: p.examDate,
      items: p.days.find((d) => d.date === today)?.items ?? [],
      overdue: overdueTasks(p.days, today).length,
    }))
    .filter((p) => p.items.length || p.overdue)
}

/** Pause a plan (kept, but out of today's revision) or resume it. */
export async function setPlanActive(id: string, userId: string, active: boolean) {
  const plan = await loadPlan(id, userId)
  const [row] = await db
    .update(schema.examPlans)
    .set({ active, updatedAt: new Date() })
    .where(eq(schema.examPlans.id, plan.id))
    .returning()
  if (!row) throw new HttpError(404, 'Plan not found')
  return toPlan(row)
}
