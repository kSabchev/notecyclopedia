import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { type DocJSON, calculatorSpecSchema, docToText, extractFormulas } from '@nc/shared'
import { ZipArchive } from 'archiver'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { type Request, type RequestHandler, Router } from 'express'
import multer from 'multer'
import unzipper from 'unzipper'
import { z } from 'zod'
import { memberCourseIds } from '../access'
import { db, schema } from '../db'
import { env } from '../env'
import { HttpError, me } from '../http'
import { reindexSource } from '../services/indexing'
import { queueIngest } from '../services/jobs'

const FORMAT = 'notecyclopedia-backup'
const VERSION = 1
const MAX_ARCHIVE_SIZE = 2 * 1024 * 1024 * 1024
const MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024
const MAX_FILE_SIZE = 100 * 1024 * 1024
const MAX_MANIFEST_SIZE = 100 * 1024 * 1024

const docSchema = z
  .object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() })
  .passthrough()
  .transform((doc) => doc as DocJSON)

const timestampSchema = z
  .string()
  .datetime()
  .transform((value) => new Date(value))
const backupSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
  createdAt: timestampSchema,
  courses: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
        description: z.string().max(2000).nullable(),
        createdAt: timestampSchema,
      }),
    )
    .max(1000),
  pages: z
    .array(
      z.object({
        id: z.string().uuid(),
        courseId: z.string().uuid(),
        title: z.string().min(1).max(200),
        type: z.enum(['lecture', 'note', 'seminar', 'source']),
        tags: z.array(z.string().min(1).max(40)).max(20),
        content: docSchema,
        aiVisible: z.boolean(),
        revision: z.number().int().positive(),
        createdAt: timestampSchema,
        updatedAt: timestampSchema,
        revisions: z
          .array(
            z.object({
              revision: z.number().int().positive(),
              title: z.string().min(1).max(200),
              content: docSchema,
              message: z.string().nullable(),
              createdAt: timestampSchema,
            }),
          )
          .min(1)
          .max(10_000),
      }),
    )
    .max(20_000),
  calculators: z
    .array(
      z.object({
        id: z.string().uuid(),
        courseId: z.string().uuid().nullable(),
        name: z.string().min(1).max(200),
        spec: calculatorSpecSchema,
        origin: z.enum(['manual', 'ai']),
        sourcePageId: z.string().uuid().nullable(),
        createdAt: timestampSchema,
        updatedAt: timestampSchema,
      }),
    )
    .max(5000),
  files: z
    .array(
      z.object({
        id: z.string().uuid(),
        courseId: z.string().uuid(),
        pageId: z.string().uuid().nullable(),
        name: z.string().min(1).max(255),
        mime: z.string().min(1).max(255),
        size: z.number().int().nonnegative().max(MAX_FILE_SIZE),
        entryPath: z.string().regex(/^files\/[0-9a-f-]{36}$/i),
        createdAt: timestampSchema,
      }),
    )
    .max(20_000),
})

type BackupData = z.infer<typeof backupSchema>

const allowedExtension = /\.(pdf|docx?|pptx?|xlsx?|odt|odp|ods|rtf|txt|md|csv|png|jpe?g|gif|webp)$/i

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_ARCHIVE_SIZE, files: 1 },
})

const receiveArchive: RequestHandler = (req, res, next) => {
  upload.single('archive')(req, res, (error?: unknown) => {
    if (error instanceof multer.MulterError) {
      next(new HttpError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.message))
    } else if (error instanceof Error) {
      next(error)
    } else if (error) {
      next(new Error(String(error)))
    } else {
      next()
    }
  })
}

export const backup = Router()

function failInvalidBackup(): never {
  throw new HttpError(400, 'Invalid backup archive')
}

export async function readBackupArchive(filePath: string) {
  let directory: unzipper.CentralDirectory
  try {
    directory = await unzipper.Open.file(filePath)
  } catch {
    return failInvalidBackup()
  }
  if (directory.files.length > 20_001) return failInvalidBackup()

  const entries = new Map<string, unzipper.File>()
  let totalSize = 0
  for (const entry of directory.files) {
    if (entry.type !== 'File' || entries.has(entry.path) || (entry.flags & 1) !== 0)
      return failInvalidBackup()
    if (entry.path !== 'manifest.json' && !/^files\/[0-9a-f-]{36}$/i.test(entry.path))
      return failInvalidBackup()
    const entryLimit = entry.path === 'manifest.json' ? MAX_MANIFEST_SIZE : MAX_FILE_SIZE
    if (entry.uncompressedSize > entryLimit) return failInvalidBackup()
    totalSize += entry.uncompressedSize
    if (totalSize > MAX_TOTAL_SIZE) return failInvalidBackup()
    entries.set(entry.path, entry)
  }

  const manifestEntry = entries.get('manifest.json')
  if (!manifestEntry) return failInvalidBackup()
  let parsed: unknown
  try {
    const chunks: Buffer[] = []
    await readEntry(
      manifestEntry,
      manifestEntry.uncompressedSize,
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk)
          callback()
        },
      }),
    )
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return failInvalidBackup()
  }
  const result = backupSchema.safeParse(parsed)
  if (!result.success) return failInvalidBackup()
  const data = result.data

  const courseIds = new Set(data.courses.map((course) => course.id))
  const pageIds = new Set(data.pages.map((page) => page.id))
  const pageCourseIds = new Map(data.pages.map((page) => [page.id, page.courseId]))
  const unique = (ids: string[]) => new Set(ids).size === ids.length
  if (
    !unique(data.courses.map((course) => course.id)) ||
    !unique(data.pages.map((page) => page.id)) ||
    !unique(data.calculators.map((calculator) => calculator.id)) ||
    !unique(data.files.map((file) => file.id))
  )
    return failInvalidBackup()

  for (const page of data.pages) {
    if (!courseIds.has(page.courseId) || page.revision !== page.revisions.length) return failInvalidBackup()
    const revisions = page.revisions.map((revision) => revision.revision)
    if (revisions.some((revision, index) => revision !== index + 1)) return failInvalidBackup()
  }
  for (const calculator of data.calculators) {
    if (
      (calculator.courseId !== null && !courseIds.has(calculator.courseId)) ||
      (calculator.sourcePageId !== null && !pageIds.has(calculator.sourcePageId))
    )
      return failInvalidBackup()
  }
  for (const file of data.files) {
    if (
      !courseIds.has(file.courseId) ||
      (file.pageId !== null && pageCourseIds.get(file.pageId) !== file.courseId) ||
      !allowedExtension.test(file.name)
    )
      return failInvalidBackup()
    if (file.entryPath !== `files/${file.id}`) return failInvalidBackup()
    const entry = entries.get(file.entryPath)
    if (!entry || entry.uncompressedSize !== file.size) return failInvalidBackup()
  }
  if (entries.size !== data.files.length + 1) return failInvalidBackup()

  return { data, entries }
}

export async function validateBackupPayloads(data: BackupData, entries: Map<string, unzipper.File>) {
  for (const file of data.files) {
    const entry = entries.get(file.entryPath)
    if (!entry) return failInvalidBackup()
    await readEntry(
      entry,
      file.size,
      new Writable({
        write(_chunk, _encoding, callback) {
          callback()
        },
      }),
    )
  }
}

async function readEntry(entry: unzipper.File, expectedSize: number, destination: Writable) {
  let actualSize = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      actualSize += chunk.length
      if (actualSize > expectedSize || actualSize > MAX_FILE_SIZE) callback(new Error('Invalid file size'))
      else callback(null, chunk)
    },
  })
  try {
    await pipeline(entry.stream(), limit, destination)
  } catch {
    return failInvalidBackup()
  }
  if (actualSize !== expectedSize) return failInvalidBackup()
}

async function insertBatches<T>(values: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let offset = 0; offset < values.length; offset += 500) {
    await insert(values.slice(offset, offset + 500))
  }
}

function formatManifest(data: BackupData) {
  return JSON.stringify(data)
}

export function validateBackupManifest(manifestJson: string) {
  return backupSchema.safeParse(JSON.parse(manifestJson))
}

backup.get('/export', async (req, res) => {
  const user = me(req)
  const courseIds = await memberCourseIds(user.id)
  const courses = courseIds.length
    ? await db.select().from(schema.courses).where(inArray(schema.courses.id, courseIds))
    : []
  const pages = courseIds.length
    ? await db.select().from(schema.pages).where(inArray(schema.pages.courseId, courseIds))
    : []
  const pageIds = pages.map((page) => page.id)
  const revisions = pageIds.length
    ? await db
        .select()
        .from(schema.pageRevisions)
        .where(inArray(schema.pageRevisions.pageId, pageIds))
        .orderBy(schema.pageRevisions.pageId, schema.pageRevisions.revision)
    : []
  const files = courseIds.length
    ? await db.select().from(schema.files).where(inArray(schema.files.courseId, courseIds))
    : []
  const calculators = await db
    .select()
    .from(schema.calculators)
    .where(
      or(
        and(isNull(schema.calculators.courseId), eq(schema.calculators.ownerId, user.id)),
        courseIds.length ? inArray(schema.calculators.courseId, courseIds) : undefined,
      ),
    )

  const revisionsByPage = new Map<string, typeof revisions>()
  for (const revision of revisions) {
    const list = revisionsByPage.get(revision.pageId) ?? []
    list.push(revision)
    revisionsByPage.set(revision.pageId, list)
  }
  const manifest: BackupData = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date(),
    courses: courses.map(({ id, name, color, description, createdAt }) => ({
      id,
      name,
      color,
      description,
      createdAt,
    })),
    pages: pages.map(
      ({ id, courseId, title, type, tags, content, aiVisible, revision, createdAt, updatedAt }) => ({
        id,
        courseId,
        title,
        type,
        tags,
        content,
        aiVisible,
        revision,
        createdAt,
        updatedAt,
        revisions: (revisionsByPage.get(id) ?? []).map(
          ({ revision, title, content, message, createdAt }) => ({
            revision,
            title,
            content,
            message,
            createdAt,
          }),
        ),
      }),
    ),
    calculators: calculators.map(
      ({ id, courseId, name, spec, origin, sourcePageId, createdAt, updatedAt }) => ({
        id,
        courseId,
        name,
        spec,
        origin,
        sourcePageId: sourcePageId && pageIds.includes(sourcePageId) ? sourcePageId : null,
        createdAt,
        updatedAt,
      }),
    ),
    files: files.map(({ id, courseId, pageId, name, mime, size, createdAt }) => ({
      id,
      courseId,
      pageId,
      name,
      mime,
      size,
      entryPath: `files/${id}`,
      createdAt,
    })),
  }

  const manifestJson = formatManifest(manifest)
  const manifestSize = Buffer.byteLength(manifestJson)
  const filesSize = files.reduce((total, file) => total + file.size, 0)
  const parsedManifest = validateBackupManifest(manifestJson)
  if (
    manifestSize > MAX_MANIFEST_SIZE ||
    filesSize + manifestSize > MAX_TOTAL_SIZE ||
    files.some((file) => file.size > MAX_FILE_SIZE) ||
    !parsedManifest.success
  )
    throw new HttpError(413, 'Your data exceeds the supported backup size or item limits')

  for (const file of files) {
    if (path.basename(file.storageKey) !== file.storageKey) throw new Error('Invalid stored file path')
    try {
      const fullPath = path.join(env.uploadDir, file.storageKey)
      await access(fullPath)
      const info = await stat(fullPath)
      if (!info.isFile() || info.size !== file.size) throw new Error('Stored file size mismatch')
    } catch {
      throw new HttpError(409, `Cannot export missing uploaded file: ${file.name}`)
    }
  }

  const archive = new ZipArchive({ zlib: { level: 6 } })
  archive.on('error', (error) => res.destroy(error))
  archive.on('warning', (error) => res.destroy(error))
  res.setHeader('content-type', 'application/zip')
  res.setHeader(
    'content-disposition',
    `attachment; filename="notecyclopedia-backup-${new Date().toISOString().slice(0, 10)}.zip"`,
  )
  res.setHeader('x-content-type-options', 'nosniff')
  archive.pipe(res)
  archive.append(manifestJson, { name: 'manifest.json' })
  for (const file of files)
    archive.file(path.join(env.uploadDir, file.storageKey), { name: `files/${file.id}` })
  await archive.finalize()
})

async function withUploadedArchive(req: Request, action: (filePath: string) => Promise<void>) {
  const file = req.file
  if (!file) throw new HttpError(400, 'Choose a backup file')
  try {
    await action(file.path)
  } finally {
    await rm(file.path, { force: true })
  }
}

backup.post('/preview', receiveArchive, async (req, res) => {
  await withUploadedArchive(req, async (filePath) => {
    const { data, entries } = await readBackupArchive(filePath)
    await validateBackupPayloads(data, entries)
    res.json({
      courses: data.courses.length,
      pages: data.pages.length,
      revisions: data.pages.reduce((count, page) => count + page.revisions.length, 0),
      calculators: data.calculators.length,
      files: data.files.length,
      createdAt: data.createdAt,
    })
  })
})

backup.post('/import', receiveArchive, async (req, res) => {
  const user = me(req)
  await withUploadedArchive(req, async (archivePath) => {
    const { data, entries } = await readBackupArchive(archivePath)
    await mkdir(env.uploadDir, { recursive: true })
    const stagingDir = await mkdtemp(path.join(env.uploadDir, '.backup-import-'))
    const movedFiles: string[] = []
    let committed = false
    try {
      const stagedFiles: {
        file: BackupData['files'][number]
        stagedPath: string
        storageKey: string
      }[] = []
      for (const file of data.files) {
        const extension = path.extname(file.name).toLowerCase()
        const storageKey = `${randomUUID()}${extension}`
        const stagedPath = path.join(stagingDir, storageKey)
        const entry = entries.get(file.entryPath)
        if (!entry) throw new HttpError(400, 'Invalid backup archive')
        await readEntry(entry, file.size, createWriteStream(stagedPath, { flags: 'wx' }))
        const info = await stat(stagedPath)
        if (info.size !== file.size) throw new HttpError(400, 'Invalid backup archive')
        stagedFiles.push({ file, stagedPath, storageKey })
      }

      for (const file of stagedFiles) {
        const destination = path.join(env.uploadDir, file.storageKey)
        await rename(file.stagedPath, destination)
        movedFiles.push(destination)
      }

      const courseMap = new Map(data.courses.map((course) => [course.id, randomUUID()]))
      const pageMap = new Map(data.pages.map((page) => [page.id, randomUUID()]))
      const fileMap = new Map(data.files.map((file) => [file.id, randomUUID()]))

      await db.transaction(async (tx) => {
        if (data.courses.length) {
          await insertBatches(
            data.courses.map((course) => ({
              id: courseMap.get(course.id) as string,
              name: course.name,
              color: course.color,
              description: course.description,
              createdBy: user.id,
              createdAt: new Date(),
            })),
            (batch) => tx.insert(schema.courses).values(batch),
          )
          await insertBatches(
            data.courses.map((course) => ({
              courseId: courseMap.get(course.id) as string,
              userId: user.id,
              role: 'owner' as const,
            })),
            (batch) => tx.insert(schema.courseMembers).values(batch),
          )
        }

        if (data.pages.length) {
          await insertBatches(
            data.pages.map((page) => ({
              id: pageMap.get(page.id) as string,
              courseId: courseMap.get(page.courseId) as string,
              title: page.title,
              type: page.type,
              tags: page.tags,
              content: page.content,
              contentText: docToText(page.content),
              aiVisible: page.aiVisible,
              revision: page.revision,
              createdBy: user.id,
              updatedBy: user.id,
              createdAt: page.createdAt,
              updatedAt: new Date(),
            })),
            (batch) => tx.insert(schema.pages).values(batch),
          )
          await insertBatches(
            data.pages.flatMap((page) =>
              page.revisions.map((revision) => ({
                pageId: pageMap.get(page.id) as string,
                revision: revision.revision,
                title: revision.title,
                content: revision.content,
                message: revision.message,
                authorId: user.id,
                createdAt: revision.createdAt,
              })),
            ),
            (batch) => tx.insert(schema.pageRevisions).values(batch),
          )
          const formulaRows = data.pages.flatMap((page) =>
            extractFormulas(page.content).map((formula, position) => ({
              ...formula,
              pageId: pageMap.get(page.id) as string,
              position,
            })),
          )
          await insertBatches(formulaRows, (batch) => tx.insert(schema.formulas).values(batch))
        }

        if (stagedFiles.length) {
          await insertBatches(
            stagedFiles.map(({ file, storageKey }) => ({
              id: fileMap.get(file.id) as string,
              courseId: courseMap.get(file.courseId) as string,
              pageId: file.pageId ? (pageMap.get(file.pageId) as string) : null,
              name: file.name,
              mime: file.mime,
              size: file.size,
              storageKey,
              status: 'uploaded' as const,
              uploadedBy: user.id,
              createdAt: file.createdAt,
            })),
            (batch) => tx.insert(schema.files).values(batch),
          )
        }

        if (data.calculators.length) {
          await insertBatches(
            data.calculators.map((calculator) => ({
              courseId: calculator.courseId ? (courseMap.get(calculator.courseId) as string) : null,
              ownerId: user.id,
              name: calculator.name,
              spec: calculator.spec,
              origin: calculator.origin,
              sourcePageId: calculator.sourcePageId ? (pageMap.get(calculator.sourcePageId) as string) : null,
              createdAt: calculator.createdAt,
              updatedAt: new Date(),
            })),
            (batch) => tx.insert(schema.calculators).values(batch),
          )
        }
      })
      committed = true

      const warnings: string[] = []
      let pageIndexError: unknown = null
      for (let offset = 0; offset < data.pages.length; offset += 4) {
        await Promise.all(
          data.pages.slice(offset, offset + 4).map(async (page) => {
            try {
              await reindexSource(
                'page',
                pageMap.get(page.id) as string,
                courseMap.get(page.courseId) as string,
                page.title,
                docToText(page.content),
              )
            } catch (error) {
              pageIndexError ??= error
            }
          }),
        )
      }
      if (pageIndexError) {
        console.error('[backup] Failed to rebuild one or more page indexes', pageIndexError)
        warnings.push('page-index')
      }
      let fileQueueError: unknown = null
      for (const file of data.files) {
        try {
          await queueIngest(fileMap.get(file.id) as string)
        } catch (error) {
          fileQueueError ??= error
          break
        }
      }
      if (fileQueueError) {
        console.error('[backup] Failed to queue one or more uploaded files for indexing', fileQueueError)
        warnings.push('file-index')
      }
      res.json({
        courses: data.courses.length,
        pages: data.pages.length,
        calculators: data.calculators.length,
        files: data.files.length,
        warnings: [...new Set(warnings)],
      })
    } finally {
      if (!committed) await Promise.all(movedFiles.map((file) => rm(file, { force: true })))
      await rm(stagingDir, { recursive: true, force: true })
    }
  })
})
