import { calculatorSpecSchema, calculatorWorkbook, exportHTML, exportJSON, exportPython } from '@nc/shared'
import { ZipArchive } from 'archiver'
import { and, desc, eq } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { assertCourse } from '../access'
import { db, schema } from '../db'
import { HttpError, me, notFound, param } from '../http'

export const calculators = Router()

/** Calculators are personal: only their owner can open, change or run them. */
export async function loadCalc(id: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Calculator not found')
  const [c] = await db
    .select()
    .from(schema.calculators)
    .where(and(eq(schema.calculators.id, id), eq(schema.calculators.ownerId, userId)))
  if (!c) throw notFound('Calculator not found')
  return c
}

/** Your calculators, archived ones included (the page filters them). */
calculators.get('/', async (req, res) => {
  const user = me(req)
  const rows = await db
    .select()
    .from(schema.calculators)
    .where(eq(schema.calculators.ownerId, user.id))
    .orderBy(desc(schema.calculators.updatedAt))
  res.json(rows)
})

const input = z.object({
  spec: calculatorSpecSchema,
  courseId: z.string().uuid().nullable().default(null),
  origin: z.enum(['manual', 'ai']).default('manual'),
  sourcePageId: z.string().uuid().nullable().default(null),
  /** The lecture of its course; a personal calculator has none. */
  lectureNumber: z.number().int().positive().max(2_147_483_647).nullable().default(null),
})

/** A lecture number belongs to a course: a personal calculator cannot have one. */
const checkLecture = (b: { courseId: string | null; lectureNumber: number | null }) => {
  if (b.lectureNumber !== null && !b.courseId)
    throw new HttpError(400, 'Choose a course to tag the calculator with one of its lectures.')
}

calculators.post('/', async (req, res) => {
  const body = input.parse(req.body)
  const user = me(req)
  checkLecture(body)
  // A tag, not sharing: any course you belong to.
  if (body.courseId) await assertCourse(body.courseId, user.id)
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
  const c = await loadCalc(param(req, 'id'), user.id)
  const body = input.pick({ spec: true, courseId: true, lectureNumber: true }).parse(req.body)
  checkLecture(body)
  if (body.courseId && body.courseId !== c.courseId) await assertCourse(body.courseId, user.id)
  const [row] = await db
    .update(schema.calculators)
    .set({
      spec: body.spec,
      name: body.spec.name,
      courseId: body.courseId,
      lectureNumber: body.lectureNumber,
      updatedAt: new Date(),
    })
    .where(eq(schema.calculators.id, c.id))
    .returning()
  res.json(row)
})

/** Archive (hide) or restore a calculator. Pages that embed it keep their copy. */
calculators.patch('/:id/archive', async (req, res) => {
  const c = await loadCalc(param(req, 'id'), me(req).id)
  const { archived } = z.object({ archived: z.boolean() }).parse(req.body)
  const [row] = await db
    .update(schema.calculators)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(schema.calculators.id, c.id))
    .returning()
  res.json(row)
})

/** A copy to rework, leaving the original as it is for the pages that embed it. */
calculators.post('/:id/duplicate', async (req, res) => {
  const user = me(req)
  const c = await loadCalc(param(req, 'id'), user.id)
  const { name } = z.object({ name: z.string().trim().min(1).max(200).optional() }).parse(req.body ?? {})
  const copyName = (name ?? `${c.name} (copy)`).slice(0, 200)
  const [row] = await db
    .insert(schema.calculators)
    .values({
      ownerId: user.id,
      courseId: c.courseId,
      lectureNumber: c.lectureNumber,
      name: copyName,
      spec: { ...c.spec, name: copyName },
      origin: c.origin,
      sourcePageId: c.sourcePageId,
      copiedFromId: c.id,
    })
    .returning()
  res.status(201).json(row)
})

calculators.delete('/:id', async (req, res) => {
  const c = await loadCalc(param(req, 'id'), me(req).id)
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
