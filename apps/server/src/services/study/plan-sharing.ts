import {
  ALL_WEEKDAYS,
  type PlanFile,
  type PlanShare,
  importPlanDays,
  planFileSchema,
  toPlanFile,
} from '@nc/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { courseRole, memberCourseIds } from '../../access'
import { db, schema } from '../../db'
import { HttpError } from '../../http'

import { loadPlan, toPlan } from './plans'

/** Export, import and sharing: copies, so each student keeps their own progress. */

async function courseName(courseId: string) {
  const [course] = await db
    .select({ name: schema.courses.name })
    .from(schema.courses)
    .where(eq(schema.courses.id, courseId))
  return course?.name
}

export async function exportPlan(id: string, userId: string): Promise<PlanFile> {
  const plan = toPlan(await loadPlan(id, userId))
  return toPlanFile(plan, await courseName(plan.courseId))
}

/** A plan from a file (or a shared copy) as a new plan of the user in `courseId`; no AI involved. */
export async function importPlan(userId: string, courseId: string, file: PlanFile, keepProgress = false) {
  const pages = await db
    .select({ id: schema.pages.id, title: schema.pages.title })
    .from(schema.pages)
    .where(eq(schema.pages.courseId, courseId))
  const { days, linked, unlinked } = importPlanDays(file, pages, keepProgress)
  const [row] = await db
    .insert(schema.examPlans)
    .values({
      userId,
      courseId,
      title: file.title,
      examDate: file.examDate,
      studyWeekdays: file.studyWeekdays.length ? file.studyWeekdays : ALL_WEEKDAYS,
      days,
      usage: null,
    })
    .returning()
  if (!row) throw new Error('exam plan insert failed')
  return { plan: toPlan(row), linked, unlinked }
}

/**
 * Send a copy of a plan to another member of its course. The copy is taken now; progress is not shared (the
 * receiver starts with nothing ticked off).
 */
export async function sharePlan(id: string, userId: string, toUserId: string) {
  const plan = toPlan(await loadPlan(id, userId))
  if (toUserId === userId) throw new HttpError(400, 'You already have this plan.')
  if (!(await courseRole(plan.courseId, toUserId)))
    throw new HttpError(404, 'That person is not a member of this course.')
  const [row] = await db
    .insert(schema.planShares)
    .values({
      fromUserId: userId,
      toUserId,
      courseId: plan.courseId,
      plan: toPlanFile(plan, await courseName(plan.courseId)),
    })
    .returning({ id: schema.planShares.id })
  return row
}

/** Copies sent to the user, for courses they are still a member of. */
export async function listShares(userId: string): Promise<PlanShare[]> {
  const ids = await memberCourseIds(userId)
  if (!ids.length) return []
  const rows = await db
    .select({
      id: schema.planShares.id,
      fromName: schema.user.name,
      courseId: schema.planShares.courseId,
      plan: schema.planShares.plan,
      createdAt: schema.planShares.createdAt,
    })
    .from(schema.planShares)
    .innerJoin(schema.user, eq(schema.user.id, schema.planShares.fromUserId))
    .where(and(eq(schema.planShares.toUserId, userId), inArray(schema.planShares.courseId, ids)))
    .orderBy(desc(schema.planShares.createdAt))
  return rows.map((r) => ({
    id: r.id,
    fromName: r.fromName,
    courseId: r.courseId,
    title: r.plan.title,
    examDate: r.plan.examDate,
    tasks: r.plan.days.reduce((n, d) => n + d.items.length, 0),
    createdAt: r.createdAt.toISOString(),
  }))
}

async function loadShare(id: string, userId: string) {
  const [share] = await db
    .select()
    .from(schema.planShares)
    .where(and(eq(schema.planShares.id, id), eq(schema.planShares.toUserId, userId)))
  if (!share) throw new HttpError(404, 'Shared plan not found')
  return share
}

/** Accept a shared copy: it becomes the user's own plan, linked to the course's pages. */
export async function acceptShare(id: string, userId: string) {
  const share = await loadShare(id, userId)
  if (!(await courseRole(share.courseId, userId))) throw new HttpError(404, 'Shared plan not found')
  const imported = await importPlan(userId, share.courseId, planFileSchema.parse(share.plan))
  await db.delete(schema.planShares).where(eq(schema.planShares.id, share.id))
  return imported.plan
}

export async function declineShare(id: string, userId: string) {
  const share = await loadShare(id, userId)
  await db.delete(schema.planShares).where(eq(schema.planShares.id, share.id))
}
