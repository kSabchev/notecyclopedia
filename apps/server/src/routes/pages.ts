import { type DocJSON, docToText, withFormulaIds } from '@nc/shared'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { assertCourse, loadPage, memberCourseIds } from '../access'
import { db, schema } from '../db'
import { HttpError, me, param } from '../http'
import { syncFormulas } from '../services/formula-index'
import { removeSource } from '../services/indexing'
import { queueReindexPage } from '../services/jobs'

export const pages = Router()
export const formulas = Router()

const docSchema = z.object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() }).passthrough()
const pageType = z.enum(['lecture', 'note', 'seminar', 'source'])
const lectureNumberSchema = z.number().int().positive().max(2_147_483_647)

const summary = {
  id: schema.pages.id,
  courseId: schema.pages.courseId,
  title: schema.pages.title,
  type: schema.pages.type,
  lectureNumber: schema.pages.lectureNumber,
  tags: schema.pages.tags,
  updatedAt: schema.pages.updatedAt,
  revision: schema.pages.revision,
}

pages.get('/', async (req, res) => {
  const { courseId, limit } = z
    .object({
      courseId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    })
    .parse(req.query)
  const user = me(req)
  let ids: string[]
  if (courseId) {
    await assertCourse(courseId, user.id)
    ids = [courseId]
  } else ids = await memberCourseIds(user.id)
  if (!ids.length) return res.json([])
  const rows = await db
    .select(summary)
    .from(schema.pages)
    .where(inArray(schema.pages.courseId, ids))
    .orderBy(
      ...(courseId
        ? [asc(schema.pages.sortOrder), desc(schema.pages.updatedAt)]
        : [desc(schema.pages.updatedAt)]),
    )
    .limit(limit)
  res.json(rows)
})

pages.post('/', async (req, res) => {
  const body = z
    .object({
      courseId: z.string().uuid(),
      sourceFileId: z.string().uuid().optional(),
      title: z.string().trim().min(1).max(200),
      type: pageType.default('note'),
      lectureNumber: lectureNumberSchema.nullable().default(null),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
      content: docSchema.default({ type: 'doc', content: [] }),
      aiVisible: z.boolean().default(true),
    })
    .parse(req.body)
  const user = me(req)
  await assertCourse(body.courseId, user.id, 'editor')
  const { sourceFileId, ...pageBody } = body
  const content = withFormulaIds(body.content as DocJSON).doc
  const page = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ sortOrder: sql<number>`coalesce(max(${schema.pages.sortOrder}), -1) + 1` })
      .from(schema.pages)
      .where(eq(schema.pages.courseId, body.courseId))
    const [p] = await tx
      .insert(schema.pages)
      .values({
        ...pageBody,
        sortOrder: last?.sortOrder ?? 0,
        content,
        contentText: docToText(content),
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning()
    if (!p) throw new Error('insert failed')
    await tx
      .insert(schema.pageRevisions)
      .values({ pageId: p.id, revision: 1, title: p.title, content, message: 'Created', authorId: user.id })
    if (sourceFileId) {
      const [linkedFile] = await tx
        .update(schema.files)
        .set({ pageId: p.id })
        .where(and(eq(schema.files.id, sourceFileId), eq(schema.files.courseId, body.courseId)))
        .returning({ id: schema.files.id })
      if (!linkedFile) throw new HttpError(400, 'Source file is not in this course')
    }
    await syncFormulas(tx, p.id, content)
    return p
  })
  await queueReindexPage(page.id)
  res.status(201).json(page)
})

pages.get('/:id', async (req, res) => {
  const page = await loadPage(param(req, 'id'), me(req).id)
  const { contentText: _omit, ...rest } = page
  res.json(rest)
})

pages.put('/order', async (req, res) => {
  const user = me(req)
  const { courseId, pageIds } = z
    .object({
      courseId: z.string().uuid(),
      pageIds: z.array(z.string().uuid()).max(500),
    })
    .parse(req.body)
  await assertCourse(courseId, user.id, 'editor')
  if (new Set(pageIds).size !== pageIds.length) throw new HttpError(400, 'Page order contains duplicates')
  const pagesInCourse = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(eq(schema.pages.courseId, courseId))
  if (pagesInCourse.length !== pageIds.length || pagesInCourse.some((page) => !pageIds.includes(page.id)))
    throw new HttpError(400, 'Page order must include all pages in this course')

  await db.transaction(async (tx) => {
    for (const [sortOrder, pageId] of pageIds.entries())
      await tx
        .update(schema.pages)
        .set({ sortOrder })
        .where(and(eq(schema.pages.id, pageId), eq(schema.pages.courseId, courseId)))
  })
  res.status(204).end()
})

pages.post('/:id/move', async (req, res) => {
  const user = me(req)
  const current = await loadPage(param(req, 'id'), user.id, 'editor')
  const { courseId } = z.object({ courseId: z.string().uuid() }).parse(req.body)
  if (courseId === current.courseId) throw new HttpError(400, 'Page is already in this course')
  await assertCourse(courseId, user.id, 'editor')

  const moved = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ sortOrder: sql<number>`coalesce(max(${schema.pages.sortOrder}), -1) + 1` })
      .from(schema.pages)
      .where(eq(schema.pages.courseId, courseId))
    const linkedFiles = await tx
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(and(eq(schema.files.pageId, current.id), eq(schema.files.courseId, current.courseId)))
    const linkedFileIds = linkedFiles.map((file) => file.id)
    const [page] = await tx
      .update(schema.pages)
      .set({ courseId, sortOrder: last?.sortOrder ?? 0, updatedAt: new Date(), updatedBy: user.id })
      .where(
        and(
          eq(schema.pages.id, current.id),
          eq(schema.pages.courseId, current.courseId),
          eq(schema.pages.revision, current.revision),
        ),
      )
      .returning()
    if (!page) throw new HttpError(409, 'This page changed while it was being moved. Reload and try again.')

    if (linkedFileIds.length) {
      await tx.update(schema.files).set({ courseId }).where(inArray(schema.files.id, linkedFileIds))
      await tx
        .update(schema.chunks)
        .set({ courseId })
        .where(
          and(
            eq(schema.chunks.sourceType, 'file'),
            inArray(schema.chunks.sourceId, linkedFileIds),
            eq(schema.chunks.courseId, current.courseId),
          ),
        )
    }
    await tx
      .update(schema.chunks)
      .set({ courseId })
      .where(
        and(
          eq(schema.chunks.sourceType, 'page'),
          eq(schema.chunks.sourceId, current.id),
          eq(schema.chunks.courseId, current.courseId),
        ),
      )
    await tx
      .update(schema.calculators)
      .set({ courseId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.calculators.sourcePageId, current.id),
          eq(schema.calculators.courseId, current.courseId),
        ),
      )
    return page
  })

  const { contentText: _omit, ...rest } = moved
  res.json(rest)
})

pages.put('/:id', async (req, res) => {
  const user = me(req)
  const current = await loadPage(param(req, 'id'), user.id, 'editor')
  const body = z
    .object({
      title: z.string().trim().min(1).max(200),
      type: pageType,
      lectureNumber: lectureNumberSchema.nullable(),
      tags: z.array(z.string().trim().min(1).max(40)).max(20),
      content: docSchema,
      aiVisible: z.boolean(),
      message: z.string().max(300).optional(),
      /** The revision the editor started from; a mismatch means someone else saved in between. */
      baseRevision: z.number().int(),
    })
    .parse(req.body)
  const { baseRevision, message, ...fields } = body
  const page = await saveRevision(
    current,
    baseRevision,
    { ...fields, content: body.content as DocJSON },
    {
      userId: user.id,
      message: message ?? null,
    },
  )
  const { contentText: _omit, ...rest } = page
  res.json(rest)
})

const conflictMessage = 'This page was changed by someone else. Reload to see their version.'

/**
 * Save new page fields as the next revision: checks for conflicting saves, records the revision,
 * updates the formula index and queues retrieval reindexing.
 */
async function saveRevision(
  current: typeof schema.pages.$inferSelect,
  baseRevision: number,
  fields: Pick<
    typeof schema.pages.$inferInsert,
    'title' | 'type' | 'lectureNumber' | 'tags' | 'aiVisible'
  > & { content: DocJSON },
  meta: { userId: string; message: string | null },
) {
  if (baseRevision !== current.revision) throw new HttpError(409, conflictMessage)
  const content = withFormulaIds(fields.content).doc
  const revision = current.revision + 1
  const page = await db.transaction(async (tx) => {
    const [p] = await tx
      .update(schema.pages)
      .set({
        ...fields,
        content,
        contentText: docToText(content),
        revision,
        updatedBy: meta.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.pages.id, current.id), eq(schema.pages.revision, current.revision)))
      .returning()
    if (!p) throw new HttpError(409, conflictMessage)
    await tx.insert(schema.pageRevisions).values({
      pageId: p.id,
      revision,
      title: p.title,
      content,
      message: meta.message,
      authorId: meta.userId,
    })
    await syncFormulas(tx, p.id, content)
    return p
  })
  await queueReindexPage(page.id)
  return page
}

pages.delete('/:id', async (req, res) => {
  const page = await loadPage(param(req, 'id'), me(req).id, 'editor')
  await removeSource('page', page.id)
  await db.delete(schema.pages).where(eq(schema.pages.id, page.id))
  res.status(204).end()
})

pages.get('/:id/revisions', async (req, res) => {
  const page = await loadPage(param(req, 'id'), me(req).id)
  const rows = await db
    .select({
      id: schema.pageRevisions.id,
      revision: schema.pageRevisions.revision,
      title: schema.pageRevisions.title,
      message: schema.pageRevisions.message,
      authorName: schema.user.name,
      createdAt: schema.pageRevisions.createdAt,
    })
    .from(schema.pageRevisions)
    .innerJoin(schema.user, eq(schema.user.id, schema.pageRevisions.authorId))
    .where(eq(schema.pageRevisions.pageId, page.id))
    .orderBy(desc(schema.pageRevisions.revision))
  res.json(rows)
})

async function loadRevision(pageId: string, rev: string) {
  const revision = z.coerce.number().int().positive().safeParse(rev)
  if (!revision.success) throw new HttpError(404, 'Revision not found')
  const [row] = await db
    .select()
    .from(schema.pageRevisions)
    .where(and(eq(schema.pageRevisions.pageId, pageId), eq(schema.pageRevisions.revision, revision.data)))
  if (!row) throw new HttpError(404, 'Revision not found')
  return row
}

pages.get('/:id/revisions/:rev', async (req, res) => {
  const page = await loadPage(param(req, 'id'), me(req).id)
  res.json(await loadRevision(page.id, param(req, 'rev')))
})

/** Make an earlier revision's title and content current again, as a new revision. */
pages.post('/:id/revisions/:rev/restore', async (req, res) => {
  const user = me(req)
  const current = await loadPage(param(req, 'id'), user.id, 'editor')
  const body = z
    .object({ baseRevision: z.number().int(), message: z.string().max(300).optional() })
    .parse(req.body)
  const old = await loadRevision(current.id, param(req, 'rev'))
  const page = await saveRevision(
    current,
    body.baseRevision,
    {
      title: old.title,
      type: current.type,
      lectureNumber: current.lectureNumber,
      tags: current.tags,
      aiVisible: current.aiVisible,
      content: old.content,
    },
    { userId: user.id, message: body.message ?? `Restored revision ${old.revision}` },
  )
  const { contentText: _omit, ...rest } = page
  res.json(rest)
})

/** Formula index across all courses the user can read. */
formulas.get('/', async (req, res) => {
  const { pinned } = z.object({ pinned: z.enum(['1', '0']).optional() }).parse(req.query)
  const ids = await memberCourseIds(me(req).id)
  if (!ids.length) return res.json([])
  const rows = await db
    .select({
      id: schema.formulas.id,
      pageId: schema.formulas.pageId,
      pageTitle: schema.pages.title,
      label: schema.formulas.label,
      latex: schema.formulas.latex,
      description: schema.formulas.description,
      pinned: schema.formulas.pinned,
    })
    .from(schema.formulas)
    .innerJoin(schema.pages, eq(schema.pages.id, schema.formulas.pageId))
    .where(
      and(inArray(schema.pages.courseId, ids), pinned === '1' ? eq(schema.formulas.pinned, true) : undefined),
    )
    .orderBy(schema.pages.title, schema.formulas.position)
  res.json(rows)
})
