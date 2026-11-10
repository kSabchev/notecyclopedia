import { and, eq, inArray, sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { assertCourse } from '../access'
import { db, schema } from '../db'
import { HttpError, me } from '../http'
import { isLectureTaken, lectureTaken } from './files'

/** Whole lectures: an original (slides or PDF) with the pages and calculators that share its number. */
export const lectures = Router()

const lectureNumber = z.number().int().positive().max(2_147_483_647)

/**
 * Move a lecture to another course (or renumber it within its course). The original moves, and with `withParts`
 * also the pages with that lecture number (lecture, theory, notes, sources, example problems), the files attached
 * to them and the calculators tagged with it, all taking the new number. Search chunks follow their sources.
 */
lectures.post('/move', async (req, res) => {
  const user = me(req)
  const body = z
    .object({
      courseId: z.string().uuid(),
      lectureNumber,
      toCourseId: z.string().uuid(),
      toLectureNumber: lectureNumber,
      withParts: z.boolean().default(true),
    })
    .parse(req.body)
  const { courseId: from, lectureNumber: n, toCourseId: to, toLectureNumber: toN, withParts } = body
  if (from === to && n === toN) throw new HttpError(400, 'The lecture is already there.')
  await assertCourse(from, user.id, 'editor')
  if (to !== from) await assertCourse(to, user.id, 'editor')

  const [original] = await db
    .select({ id: schema.files.id, pageId: schema.files.pageId })
    .from(schema.files)
    .where(and(eq(schema.files.courseId, from), eq(schema.files.lectureNumber, n)))
  if (!original) throw new HttpError(404, `Lecture ${n} has no original in this course.`)

  const result = await db
    .transaction(async (tx) => {
      const pageIds = withParts
        ? (
            await tx
              .select({ id: schema.pages.id })
              .from(schema.pages)
              .where(and(eq(schema.pages.courseId, from), eq(schema.pages.lectureNumber, n)))
              .orderBy(schema.pages.sortOrder)
          ).map((p) => p.id)
        : []
      const attached = pageIds.length
        ? (
            await tx
              .select({ id: schema.files.id })
              .from(schema.files)
              .where(and(eq(schema.files.courseId, from), inArray(schema.files.pageId, pageIds)))
          )
            .map((f) => f.id)
            .filter((id) => id !== original.id)
        : []

      // The original: it keeps its page only if that page moves with it.
      const [file] = await tx
        .update(schema.files)
        .set({
          courseId: to,
          lectureNumber: toN,
          pageId:
            to === from || (original.pageId && pageIds.includes(original.pageId)) ? original.pageId : null,
        })
        .where(eq(schema.files.id, original.id))
        .returning({
          id: schema.files.id,
          courseId: schema.files.courseId,
          lectureNumber: schema.files.lectureNumber,
        })

      if (pageIds.length) {
        const [last] = await tx
          .select({ sortOrder: sql<number>`coalesce(max(${schema.pages.sortOrder}), -1) + 1` })
          .from(schema.pages)
          .where(eq(schema.pages.courseId, to))
        for (const [i, id] of pageIds.entries())
          await tx
            .update(schema.pages)
            .set({
              courseId: to,
              lectureNumber: toN,
              ...(to !== from && { sortOrder: (last?.sortOrder ?? 0) + i }),
              updatedAt: new Date(),
              updatedBy: user.id,
            })
            .where(eq(schema.pages.id, id))
      }
      // Files attached to the moved pages go along; one that was another lecture's original is unmarked there.
      if (attached.length && to !== from)
        await tx
          .update(schema.files)
          .set({ courseId: to, lectureNumber: null })
          .where(inArray(schema.files.id, attached))

      const calcs = withParts
        ? await tx
            .update(schema.calculators)
            .set({ courseId: to, lectureNumber: toN, updatedAt: new Date() })
            .where(
              and(
                eq(schema.calculators.courseId, from),
                eq(schema.calculators.lectureNumber, n),
                // Tags are personal: your calculators move with the lecture.
                eq(schema.calculators.ownerId, user.id),
              ),
            )
            .returning({ id: schema.calculators.id })
        : []
      // As when a page moves: calculators made from a moved page follow it.
      if (pageIds.length && to !== from)
        await tx
          .update(schema.calculators)
          .set({ courseId: to, updatedAt: new Date() })
          .where(
            and(
              eq(schema.calculators.courseId, from),
              inArray(schema.calculators.sourcePageId, pageIds),
              eq(schema.calculators.ownerId, user.id),
            ),
          )

      if (to !== from) {
        const fileIds = [original.id, ...attached]
        await tx
          .update(schema.chunks)
          .set({ courseId: to })
          .where(and(eq(schema.chunks.sourceType, 'file'), inArray(schema.chunks.sourceId, fileIds)))
        if (pageIds.length)
          await tx
            .update(schema.chunks)
            .set({ courseId: to })
            .where(and(eq(schema.chunks.sourceType, 'page'), inArray(schema.chunks.sourceId, pageIds)))
      }
      return { original: file, pages: pageIds.length, calculators: calcs.length }
    })
    .catch(async (e) => {
      throw isLectureTaken(e) ? await lectureTaken(to, toN) : e
    })
  res.json(result)
})
