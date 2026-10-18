import type { CourseRole } from '@nc/shared'
import { and, eq } from 'drizzle-orm'
import { db, schema } from './db'
import { forbidden, notFound } from './http'

const rank: Record<CourseRole, number> = { viewer: 1, editor: 2, owner: 3 }

export async function courseRole(courseId: string, userId: string): Promise<CourseRole | null> {
  const [m] = await db
    .select({ role: schema.courseMembers.role })
    .from(schema.courseMembers)
    .where(and(eq(schema.courseMembers.courseId, courseId), eq(schema.courseMembers.userId, userId)))
  return m?.role ?? null
}

/** Throws unless the user has at least `min` role in the course. */
export async function assertCourse(courseId: string, userId: string, min: CourseRole = 'viewer') {
  const role = await courseRole(courseId, userId)
  if (!role) throw notFound('Course not found')
  if (rank[role] < rank[min]) throw forbidden()
  return role
}

export async function memberCourseIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.courseMembers.courseId })
    .from(schema.courseMembers)
    .where(eq(schema.courseMembers.userId, userId))
  return rows.map((r) => r.id)
}

export async function loadPage(pageId: string, userId: string, min: CourseRole = 'viewer') {
  const [page] = await db.select().from(schema.pages).where(eq(schema.pages.id, pageId))
  if (!page) throw notFound('Page not found')
  await assertCourse(page.courseId, userId, min)
  return page
}
