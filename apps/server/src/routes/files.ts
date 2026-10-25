import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { assertCourse, loadPage, memberCourseIds } from '../access'
import { db, schema } from '../db'
import { env } from '../env'
import { HttpError, me, notFound, param } from '../http'
import { aiConfigured, generateArticleDraft } from '../services/claude'
import { removeSource } from '../services/indexing'
import { queueIngest } from '../services/jobs'

mkdirSync(env.uploadDir, { recursive: true })

const ALLOWED = /\.(pdf|docx?|pptx?|xlsx?|odt|odp|ods|rtf|txt|md|csv|png|jpe?g|gif|webp)$/i

const upload = multer({
  storage: multer.diskStorage({
    destination: env.uploadDir,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.test(file.originalname)) cb(null, true)
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
  createdAt: schema.files.createdAt,
}

files.get('/', async (req, res) => {
  const q = z
    .object({ courseId: z.string().uuid().optional(), pageId: z.string().uuid().optional() })
    .parse(req.query)
  const user = me(req)
  if (q.pageId) await loadPage(q.pageId, user.id)
  if (q.courseId) await assertCourse(q.courseId, user.id)
  const ids = q.courseId ? [q.courseId] : await memberCourseIds(user.id)
  if (!ids.length) return res.json([])
  const rows = await db
    .select(publicCols)
    .from(schema.files)
    .where(and(inArray(schema.files.courseId, ids), q.pageId ? eq(schema.files.pageId, q.pageId) : undefined))
    .orderBy(desc(schema.files.createdAt))
    .limit(200)
  res.json(rows)
})

files.post('/', upload.array('files'), async (req, res) => {
  const uploaded = (req.files as Express.Multer.File[] | undefined) ?? []
  try {
    const { courseId, pageId } = z
      .object({ courseId: z.string().uuid(), pageId: z.string().uuid().optional() })
      .parse(req.body)
    const user = me(req)
    await assertCourse(courseId, user.id, 'editor')
    if (pageId) {
      const page = await loadPage(pageId, user.id, 'editor')
      if (page.courseId !== courseId) throw new HttpError(400, 'Page is in a different course')
    }
    if (!uploaded.length) throw new HttpError(400, 'No files received')
    const rows = await db
      .insert(schema.files)
      .values(
        uploaded.map((f) => ({
          courseId,
          pageId: pageId ?? null,
          // multer decodes names as latin1; restore UTF-8 (Cyrillic file names)
          name: Buffer.from(f.originalname, 'latin1').toString('utf8'),
          mime: f.mimetype,
          size: f.size,
          storageKey: f.filename,
          uploadedBy: user.id,
        })),
      )
      .returning(publicCols)
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
  const inline = req.query.inline === '1'
  res.setHeader('content-type', f.mime)
  res.setHeader(
    'content-disposition',
    `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  )
  res.setHeader('x-content-type-options', 'nosniff')
  res.sendFile(path.join(env.uploadDir, f.storageKey))
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
