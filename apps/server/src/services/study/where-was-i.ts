import type { WhereWasI } from '@nc/shared'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { memberCourseIds } from '../../access'
import { db, schema } from '../../db'

/** Where was I: the pages you opened and what your questions were about, from your own activity; no AI. */

export async function recordVisit(userId: string, pageId: string) {
  await db
    .insert(schema.pageVisits)
    .values({ userId, pageId })
    .onConflictDoUpdate({
      target: [schema.pageVisits.userId, schema.pageVisits.pageId],
      set: { visitedAt: new Date() },
    })
}

/** How far back "topics you asked about" looks. */
const TOPIC_DAYS = 30

export async function whereWasI(userId: string): Promise<WhereWasI> {
  const ids = await memberCourseIds(userId)
  const courseIds = ids.length
    ? sql`ARRAY[${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}]::uuid[]`
    : sql`ARRAY[]::uuid[]`
  const [viewed, threads, topics] = await Promise.all([
    ids.length
      ? db
          .select({
            id: schema.pages.id,
            title: schema.pages.title,
            courseId: schema.pages.courseId,
            type: schema.pages.type,
            visitedAt: schema.pageVisits.visitedAt,
          })
          .from(schema.pageVisits)
          .innerJoin(schema.pages, eq(schema.pages.id, schema.pageVisits.pageId))
          .where(and(eq(schema.pageVisits.userId, userId), inArray(schema.pages.courseId, ids)))
          .orderBy(desc(schema.pageVisits.visitedAt))
          .limit(6)
      : [],
    db
      .select({
        id: schema.aiThreads.id,
        title: schema.aiThreads.title,
        mode: schema.aiThreads.mode,
        updatedAt: schema.aiThreads.updatedAt,
      })
      .from(schema.aiThreads)
      .where(eq(schema.aiThreads.userId, userId))
      .orderBy(desc(schema.aiThreads.updatedAt))
      .limit(5),
    // The pages your recent answers were drawn from: what you have been asking about.
    db.execute<{
      page_id: string
      title: string
      course_id: string
      questions: number
      last_asked: Date
    }>(sql`
      SELECT p.id AS page_id, p.title, p.course_id, count(DISTINCT m.id)::int AS questions,
             max(m.created_at) AS last_asked
        FROM ai_messages m
        JOIN ai_threads t ON t.id = m.thread_id
        CROSS JOIN LATERAL jsonb_array_elements(m.citations) c
        JOIN pages p ON p.id::text = c->>'sourceId'
       WHERE t.user_id = ${userId} AND m.role = 'assistant' AND c->>'sourceType' = 'page'
         AND m.created_at > now() - make_interval(days => ${TOPIC_DAYS})
         AND p.course_id = ANY(${courseIds})
       GROUP BY p.id
       ORDER BY questions DESC, last_asked DESC
       LIMIT 6`),
  ])
  const iso = (d: Date | string) => new Date(d).toISOString()
  return {
    viewed: viewed.map((v) => ({ ...v, visitedAt: iso(v.visitedAt) })),
    threads: threads.map((t) => ({ ...t, updatedAt: iso(t.updatedAt) })),
    topics: topics.rows.map((r) => ({
      pageId: r.page_id,
      title: r.title,
      courseId: r.course_id,
      questions: Number(r.questions),
      lastAskedAt: iso(r.last_asked),
    })),
  }
}
