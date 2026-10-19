import { type DocJSON, docToText, extractFormulas } from '@nc/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { assertCourse, loadPage, memberCourseIds } from '../access'
import { db, schema } from '../db'
import { HttpError, me, param } from '../http'
import { reindexSource, removeSource } from '../services/indexing'

export const pages = Router()
export const formulas = Router()

const docSchema = z.object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() }).passthrough()
const pageType = z.enum(['lecture', 'note', 'seminar', 'source'])

const summary = {
  id: schema.pages.id,
  courseId: schema.pages.courseId,
  title: schema.pages.title,
  type: schema.pages.type,
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
    .orderBy(desc(schema.pages.updatedAt))
    .limit(limit)
  res.json(rows)
})

/** Recompute derived data (formula index + retrieval chunks) after a save. */
async function afterSave(page: typeof schema.pages.$inferSelect) {
  const found = extractFormulas(page.content)
  await db.transaction(async (tx) => {
    await tx.delete(schema.formulas).where(eq(schema.formulas.pageId, page.id))
    if (found.length)
      await tx.insert(schema.formulas).values(found.map((f, i) => ({ ...f, pageId: page.id, position: i })))
  })
  if (page.aiVisible) await reindexSource('page', page.id, page.courseId, page.title, page.contentText)
  else await removeSource('page', page.id)
}

pages.post('/', async (req, res) => {
  const body = z
    .object({
      courseId: z.string().uuid(),
      title: z.string().trim().min(1).max(200),
      type: pageType.default('note'),
      tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
      content: docSchema.default({ type: 'doc', content: [] }),
      aiVisible: z.boolean().default(true),
    })
    .parse(req.body)
  const user = me(req)
  await assertCourse(body.courseId, user.id, 'editor')
  const content = body.content as DocJSON
  const page = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(schema.pages)
      .values({ ...body, content, contentText: docToText(content), createdBy: user.id, updatedBy: user.id })
      .returning()
    if (!p) throw new Error('insert failed')
    await tx
      .insert(schema.pageRevisions)
      .values({ pageId: p.id, revision: 1, title: p.title, content, message: 'Created', authorId: user.id })
    return p
  })
  await afterSave(page)
  res.status(201).json(page)
})

pages.get('/:id', async (req, res) => {
  const page = await loadPage(param(req, 'id'), me(req).id)
  const { contentText: _omit, ...rest } = page
  res.json(rest)
})

pages.post('/:id/move', async (req, res) => {
  const user = me(req)
  const current = await loadPage(param(req, 'id'), user.id, 'editor')
  const { courseId } = z.object({ courseId: z.string().uuid() }).parse(req.body)
  if (courseId === current.courseId) throw new HttpError(400, 'Page is already in this course')
  await assertCourse(courseId, user.id, 'editor')

  const moved = await db.transaction(async (tx) => {
    const linkedFiles = await tx
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(and(eq(schema.files.pageId, current.id), eq(schema.files.courseId, current.courseId)))
    const linkedFileIds = linkedFiles.map((file) => file.id)
    const [page] = await tx
      .update(schema.pages)
      .set({ courseId, updatedAt: new Date(), updatedBy: user.id })
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
      tags: z.array(z.string().trim().min(1).max(40)).max(20),
      content: docSchema,
      aiVisible: z.boolean(),
      message: z.string().max(300).optional(),
      /** The revision the editor started from; a mismatch means someone else saved in between. */
      baseRevision: z.number().int(),
    })
    .parse(req.body)
  if (body.baseRevision !== current.revision)
    throw new HttpError(409, 'This page was changed by someone else. Reload to see their version.')
  const content = body.content as DocJSON
  const revision = current.revision + 1
  const page = await db.transaction(async (tx) => {
    const [p] = await tx
      .update(schema.pages)
      .set({
        title: body.title,
        type: body.type,
        tags: body.tags,
        aiVisible: body.aiVisible,
        content,
        contentText: docToText(content),
        revision,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.pages.id, current.id), eq(schema.pages.revision, current.revision)))
      .returning()
    if (!p) throw new HttpError(409, 'This page was changed by someone else. Reload to see their version.')
    await tx.insert(schema.pageRevisions).values({
      pageId: p.id,
      revision,
      title: p.title,
      content,
      message: body.message ?? null,
      authorId: user.id,
    })
    return p
  })
  await afterSave(page)
  const { contentText: _omit, ...rest } = page
  res.json(rest)
})

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

pages.get('/:id/revisions/:rev', async (req, res) => {
  const page = await loadPage(param(req, 'id'), me(req).id)
  const [rev] = await db
    .select()
    .from(schema.pageRevisions)
    .where(
      and(
        eq(schema.pageRevisions.pageId, page.id),
        eq(schema.pageRevisions.revision, Number(param(req, 'rev'))),
      ),
    )
  if (!rev) throw new HttpError(404, 'Revision not found')
  res.json(rev)
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
