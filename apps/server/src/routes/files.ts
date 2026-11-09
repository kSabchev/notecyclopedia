import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { and, asc, desc, eq, ilike, inArray, isNotNull } from 'drizzle-orm'
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { assertCourse, loadPage, memberCourseIds } from '../access'
import { db, schema } from '../db'
import { env } from '../env'
import { HttpError, me, notFound, param } from '../http'
import { aiConfigured, generateArticleDraft } from '../services/claude'
import { fileType } from '../services/file-types'
import { removeSource } from '../services/indexing'
import { queueIngest } from '../services/jobs'

mkdirSync(env.uploadDir, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: env.uploadDir,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (fileType(file.originalname)) cb(null, true)
    else cb(new HttpError(400, `File type not supported: ${file.originalname}`))
  },
})

export const files = Router()

const publicCols = {
  id: schema.files.id,
  courseId: schema.files.courseId,
  pageId: schema.files.pageId,
  name: schema.files.name,
  mime: schema.files.mime,
  size: schema.files.size,
  status: schema.files.status,
  error: schema.files.error,
  lectureNumber: schema.files.lectureNumber,
  createdAt: schema.files.createdAt,
}

const lectureNumber = z.number().int().positive().max(2_147_483_647)

/** Another upload of the course is already the original of that lecture (unique index). */
export const isLectureTaken = (e: unknown) =>
  (e as { code?: string; cause?: { code?: string } }).code === '23505' ||
  (e as { cause?: { code?: string } }).cause?.code === '23505'

/** Which course and which file already hold the lecture, so the message says where to look. */
export async function lectureTaken(courseId: string, n: number) {
  const [course] = await db
    .select({ name: schema.courses.name })
    .from(schema.courses)
    .where(eq(schema.courses.id, courseId))
  const [holder] = await db
    .select({ name: schema.files.name })
    .from(schema.files)
    .where(and(eq(schema.files.courseId, courseId), eq(schema.files.lectureNumber, n)))
  return new HttpError(
    409,
    `Lecture ${n} of ${course?.name ?? 'this course'} already has an original${holder ? ` (${holder.name})` : ''}. Unmark that file first, or pick another number.`,
  )
}

files.get('/', async (req, res) => {
  const q = z
    .object({
      courseId: z.string().uuid().optional(),
      pageId: z.string().uuid().optional(),
      /** Only the lectures' originals, all of them (the plain list is paged). */
      originals: z.literal('1').optional(),
      /** Part of the file name. */
      q: z.string().trim().max(200).optional(),
      offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
      limit: z.coerce.number().int().min(1).max(200).default(200),
    })
    .parse(req.query)
  const user = me(req)
  if (q.pageId) await loadPage(q.pageId, user.id)
  if (q.courseId) await assertCourse(q.courseId, user.id)
  const ids = q.courseId ? [q.courseId] : await memberCourseIds(user.id)
  if (!ids.length) return res.json([])
  const rows = await db
    .select(publicCols)
    .from(schema.files)
    .where(
      and(
        inArray(schema.files.courseId, ids),
        q.pageId ? eq(schema.files.pageId, q.pageId) : undefined,
        q.originals ? isNotNull(schema.files.lectureNumber) : undefined,
        // A literal match: % and _ in the search are not wildcards.
        q.q ? ilike(schema.files.name, `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
      ),
    )
    .orderBy(
      ...(q.originals
        ? [asc(schema.files.lectureNumber)]
        : [desc(schema.files.createdAt), desc(schema.files.id)]),
    )
    .limit(q.originals ? 10_000 : q.limit)
    .offset(q.originals ? 0 : q.offset)
  res.json(rows)
})

files.post('/', upload.array('files'), async (req, res) => {
  const uploaded = (req.files as Express.Multer.File[] | undefined) ?? []
  try {
    const {
      courseId,
      pageId,
      lectureNumber: original,
    } = z
      .object({
        courseId: z.string().uuid(),
        pageId: z.string().uuid().optional(),
        /** Mark the (single) upload as the original of this lecture. */
        lectureNumber: z.preprocess(
          (v) => (v === '' ? undefined : v),
          z.coerce.number().pipe(lectureNumber).optional(),
        ),
      })
      .parse(req.body)
    const user = me(req)
    await assertCourse(courseId, user.id, 'editor')
    if (pageId) {
      const page = await loadPage(pageId, user.id, 'editor')
      if (page.courseId !== courseId) throw new HttpError(400, 'Page is in a different course')
    }
    if (!uploaded.length) throw new HttpError(400, 'No files received')
    if (original !== undefined && uploaded.length > 1)
      throw new HttpError(400, 'Upload the original of a lecture on its own.')
    const rows = await db
      .insert(schema.files)
      .values(
        uploaded.map((f) => ({
          courseId,
          pageId: pageId ?? null,
          // multer decodes names as latin1; restore UTF-8 (Cyrillic file names)
          name: Buffer.from(f.originalname, 'latin1').toString('utf8'),
          mime: fileType(f.originalname)?.mime ?? 'application/octet-stream',
          size: f.size,
          storageKey: f.filename,
          lectureNumber: original ?? null,
          uploadedBy: user.id,
        })),
      )
      .returning(publicCols)
      .catch(async (e) => {
        throw isLectureTaken(e) && original !== undefined ? await lectureTaken(courseId, original) : e
      })
    for (const r of rows) await queueIngest(r.id)
    res.status(201).json(rows)
  } catch (e) {
    await Promise.all(uploaded.map((f) => unlink(f.path).catch(() => {})))
    throw e
  }
})

async function loadFile(id: string, userId: string, min: 'viewer' | 'editor' = 'viewer') {
  const [f] = await db.select().from(schema.files).where(eq(schema.files.id, id))
  if (!f) throw notFound('File not found')
  await assertCourse(f.courseId, userId, min)
  return f
}

files.get('/:id/download', async (req, res) => {
  const f = await loadFile(param(req, 'id'), me(req).id)
  // Older rows store the type the browser claimed; serve by extension, and only safe types inline.
  const type = fileType(f.storageKey)
  const inline = req.query.inline === '1' && type?.inline === true
  res.setHeader('content-type', type?.mime ?? 'application/octet-stream')
  res.setHeader(
    'content-disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  )
  res.setHeader('x-content-type-options', 'nosniff')
  // The path is built from our own storage key; allow an upload directory with a dot in its path.
  res.sendFile(path.join(env.uploadDir, f.storageKey), { dotfiles: 'allow' })
})

files.post('/:id/article-draft', async (req, res) => {
  const userId = me(req).id
  const file = await loadFile(param(req, 'id'), userId, 'editor')
  if (!file.name.toLowerCase().endsWith('.pdf') && file.mime !== 'application/pdf')
    throw new HttpError(400, 'Only PDF files can be turned into article drafts')
  if (file.status !== 'indexed' || !file.text?.trim())
    throw new HttpError(409, 'Wait for the PDF to finish indexing before creating an article')
  if (!aiConfigured()) throw new HttpError(503, 'AI is not configured. Add ANTHROPIC_API_KEY to .env')
  if (file.text.length > 80_000)
    throw new HttpError(
      413,
      'This PDF is too long to turn into one article. Use a shorter PDF or split it into sections.',
    )

  res.json(await generateArticleDraft(file.name, file.text, userId))
})

files.patch('/:id', async (req, res) => {
  const user = me(req)
  const f = await loadFile(param(req, 'id'), user.id, 'editor')
  const { pageId } = z.object({ pageId: z.string().uuid().nullable() }).parse(req.body)
  if (pageId) {
    const page = await loadPage(pageId, user.id, 'editor')
    if (page.courseId !== f.courseId) throw new HttpError(400, 'Page is in a different course')
  }
  const [row] = await db
    .update(schema.files)
    .set({ pageId })
    .where(eq(schema.files.id, f.id))
    .returning(publicCols)
  res.json(row)
})

/**
 * Mark an upload as the original of a lecture, or unmark it (null). With another `courseId`, it becomes the original
 * of that course's lecture: the file moves there (and leaves the page it was attached to, which stays behind).
 */
files.patch('/:id/lecture', async (req, res) => {
  const user = me(req)
  const f = await loadFile(param(req, 'id'), user.id, 'editor')
  const body = z
    .object({ lectureNumber: lectureNumber.nullable(), courseId: z.string().uuid().optional() })
    .parse(req.body)
  const n = body.lectureNumber
  const courseId = body.courseId ?? f.courseId
  const moving = courseId !== f.courseId
  if (moving) await assertCourse(courseId, user.id, 'editor')
  const row = await db
    .transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.files)
        .set(moving ? { lectureNumber: n, courseId, pageId: null } : { lectureNumber: n })
        .where(eq(schema.files.id, f.id))
        .returning(publicCols)
      if (moving)
        await tx
          .update(schema.chunks)
          .set({ courseId })
          .where(and(eq(schema.chunks.sourceType, 'file'), eq(schema.chunks.sourceId, f.id)))
      return updated
    })
    .catch(async (e) => {
      throw isLectureTaken(e) && n !== null ? await lectureTaken(courseId, n) : e
    })
  res.json(row)
})

files.post('/:id/reindex', async (req, res) => {
  const f = await loadFile(param(req, 'id'), me(req).id, 'editor')
  await queueIngest(f.id)
  res.status(202).json({ ok: true })
})

files.delete('/:id', async (req, res) => {
  const f = await loadFile(param(req, 'id'), me(req).id, 'editor')
  await removeSource('file', f.id)
  await db.delete(schema.files).where(eq(schema.files.id, f.id))
  await unlink(path.join(env.uploadDir, f.storageKey)).catch(() => {})
  res.status(204).end()
})
