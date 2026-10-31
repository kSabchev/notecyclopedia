import { calculatorSpecSchema, calculatorWorkbook, exportHTML, exportJSON, exportPython } from '@nc/shared'
import { ZipArchive } from 'archiver'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { assertCourse, memberCourseIds } from '../access'
import { db, schema } from '../db'
import { HttpError, me, notFound, param } from '../http'

export const calculators = Router()

export async function loadCalc(id: string, userId: string, edit = false) {
  const [c] = await db.select().from(schema.calculators).where(eq(schema.calculators.id, id))
  if (!c) throw notFound('Calculator not found')
  if (c.courseId) await assertCourse(c.courseId, userId, edit ? 'editor' : 'viewer')
  else if (c.ownerId !== userId) throw notFound('Calculator not found')
  return c
}

calculators.get('/', async (req, res) => {
  const user = me(req)
  const ids = await memberCourseIds(user.id)
  const rows = await db
    .select()
    .from(schema.calculators)
    .where(
      or(
        and(isNull(schema.calculators.courseId), eq(schema.calculators.ownerId, user.id)),
        ids.length ? inArray(schema.calculators.courseId, ids) : undefined,
      ),
    )
    .orderBy(desc(schema.calculators.updatedAt))
  res.json(rows)
})

const input = z.object({
  spec: calculatorSpecSchema,
  courseId: z.string().uuid().nullable().default(null),
  origin: z.enum(['manual', 'ai']).default('manual'),
  sourcePageId: z.string().uuid().nullable().default(null),
})

calculators.post('/', async (req, res) => {
  const body = input.parse(req.body)
  const user = me(req)
  if (body.courseId) await assertCourse(body.courseId, user.id, 'editor')
  const [c] = await db
    .insert(schema.calculators)
    .values({ ...body, name: body.spec.name, ownerId: user.id })
    .returning()
  res.status(201).json(c)
})

calculators.get('/:id', async (req, res) => {
  res.json(await loadCalc(param(req, 'id'), me(req).id))
})

calculators.put('/:id', async (req, res) => {
  const user = me(req)
  const c = await loadCalc(param(req, 'id'), user.id, true)
  const body = input.pick({ spec: true, courseId: true }).parse(req.body)
  if (body.courseId && body.courseId !== c.courseId) await assertCourse(body.courseId, user.id, 'editor')
  const [row] = await db
    .update(schema.calculators)
    .set({ spec: body.spec, name: body.spec.name, courseId: body.courseId, updatedAt: new Date() })
    .where(eq(schema.calculators.id, c.id))
    .returning()
  res.json(row)
})

calculators.delete('/:id', async (req, res) => {
  const c = await loadCalc(param(req, 'id'), me(req).id, true)
  await db.delete(schema.calculators).where(eq(schema.calculators.id, c.id))
  res.status(204).end()
})

/** The files of an .xlsx workbook, zipped in memory. */
async function zipped(files: { path: string; content: string }[]): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 6 } })
  const chunks: Buffer[] = []
  archive.on('data', (chunk: Buffer) => chunks.push(chunk))
  const ended = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve())
    archive.on('error', reject)
  })
  for (const file of files) archive.append(file.content, { name: file.path })
  await archive.finalize()
  await ended
  return Buffer.concat(chunks)
}

const EXPORT_TYPES = {
  json: 'application/json; charset=utf-8',
  py: 'text/x-python; charset=utf-8',
  html: 'text/html; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

calculators.get('/:id/export', async (req, res) => {
  const c = await loadCalc(param(req, 'id'), me(req).id)
  const { format } = z.object({ format: z.enum(['json', 'py', 'html', 'xlsx']) }).parse(req.query)
  const base =
    c.name
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'calculator'
  let body: string | Buffer
  try {
    body =
      format === 'json'
        ? exportJSON(c.spec)
        : format === 'py'
          ? exportPython(c.spec)
          : format === 'html'
            ? exportHTML(c.spec)
            : await zipped(calculatorWorkbook(c.spec))
  } catch (e) {
    throw new HttpError(422, `Cannot export: ${(e as Error).message}`)
  }
  res.setHeader('content-type', EXPORT_TYPES[format])
  res.setHeader(
    'content-disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.${format}`)}`,
  )
  res.send(body)
})
