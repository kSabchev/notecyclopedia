import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  type DocJSON,
  docToText,
  extractFormulas,
  remapImageFiles,
  remapPageLinks,
  withBlockIds,
} from '@nc/shared'
import { db, schema } from '../../db'
import { env } from '../../env'
import { HttpError } from '../../http'
import { fileType } from '../file-types'
import { queueIngest, queueReindexPage } from '../jobs'
import { syncReferences, syncTerms } from '../term-index'
import { readBackupArchive, readEntry } from './archive'
import type { BackupData } from './format'

async function insertBatches<T>(values: T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let offset = 0; offset < values.length; offset += 500) {
    await insert(values.slice(offset, offset + 500))
  }
}

/**
 * Restores a backup as copies: new ids for every course, page and file, links and references remapped to the
 * copies, files moved into place only when the database transaction commits. Returns what was restored.
 */
export async function restoreBackup(userId: string, archivePath: string) {
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
            createdBy: userId,
            createdAt: new Date(),
          })),
          (batch) => tx.insert(schema.courses).values(batch),
        )
        await insertBatches(
          data.courses.map((course, sortOrder) => ({
            courseId: courseMap.get(course.id) as string,
            userId: userId,
            role: 'owner' as const,
            sortOrder,
          })),
          (batch) => tx.insert(schema.courseMembers).values(batch),
        )
      }

      if (data.pages.length) {
        // Image blocks and links between pages point at the imported copies. Backups made before
        // formula and heading ids existed carry blocks without them.
        const toImportedFile = (id: string) => fileMap.get(id)
        const toImportedPage = (id: string) => pageMap.get(id)
        const remap = (doc: DocJSON) => remapPageLinks(remapImageFiles(doc, toImportedFile), toImportedPage)
        for (const page of data.pages) {
          page.content = withBlockIds(remap(page.content)).doc
          for (const revision of page.revisions) revision.content = remap(revision.content)
        }
        const pageOrderByCourse = new Map<string, number>()
        await insertBatches(
          data.pages.map((page) => {
            const sortOrder = pageOrderByCourse.get(page.courseId) ?? 0
            pageOrderByCourse.set(page.courseId, sortOrder + 1)
            return {
              id: pageMap.get(page.id) as string,
              courseId: courseMap.get(page.courseId) as string,
              title: page.title,
              type: page.type,
              lectureNumber: page.lectureNumber,
              sortOrder,
              tags: page.tags,
              content: page.content,
              contentText: docToText(page.content),
              aiVisible: page.aiVisible,
              revision: page.revision,
              createdBy: userId,
              updatedBy: userId,
              createdAt: page.createdAt,
              updatedAt: new Date(),
            }
          }),
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
              authorId: userId,
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
        for (const page of data.pages) {
          await syncTerms(tx, pageMap.get(page.id) as string, page.content)
          await syncReferences(tx, pageMap.get(page.id) as string, page.content)
        }
      }

      if (stagedFiles.length) {
        await insertBatches(
          stagedFiles.map(({ file, storageKey }) => ({
            id: fileMap.get(file.id) as string,
            courseId: courseMap.get(file.courseId) as string,
            pageId: file.pageId ? (pageMap.get(file.pageId) as string) : null,
            name: file.name,
            mime: fileType(file.name)?.mime ?? 'application/octet-stream',
            size: file.size,
            storageKey,
            lectureNumber: file.lectureNumber,
            status: 'uploaded' as const,
            uploadedBy: userId,
            createdAt: file.createdAt,
          })),
          (batch) => tx.insert(schema.files).values(batch),
        )
      }

      if (data.calculators.length) {
        await insertBatches(
          data.calculators.map((calculator) => ({
            courseId: calculator.courseId ? (courseMap.get(calculator.courseId) as string) : null,
            ownerId: userId,
            name: calculator.name,
            spec: calculator.spec,
            origin: calculator.origin,
            sourcePageId: calculator.sourcePageId ? (pageMap.get(calculator.sourcePageId) as string) : null,
            lectureNumber: calculator.lectureNumber,
            archivedAt: calculator.archivedAt,
            createdAt: calculator.createdAt,
            updatedAt: new Date(),
          })),
          (batch) => tx.insert(schema.calculators).values(batch),
        )
      }

      if (data.constants.length) {
        await insertBatches(
          data.constants.map((constant) => ({
            courseId: courseMap.get(constant.courseId) as string,
            key: constant.key,
            name: constant.name,
            symbol: constant.symbol,
            value: constant.value,
            unit: constant.unit,
            description: constant.description,
            createdBy: userId,
            createdAt: constant.createdAt,
            updatedAt: new Date(),
          })),
          (batch) => tx.insert(schema.courseConstants).values(batch),
        )
      }
    })
    committed = true

    const warnings: string[] = []
    let pageIndexError: unknown = null
    for (const page of data.pages) {
      try {
        await queueReindexPage(pageMap.get(page.id) as string)
      } catch (error) {
        pageIndexError ??= error
      }
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
    return {
      courses: data.courses.length,
      pages: data.pages.length,
      calculators: data.calculators.length,
      constants: data.constants.length,
      files: data.files.length,
      warnings: [...new Set(warnings)],
    }
  } finally {
    if (!committed) await Promise.all(movedFiles.map((file) => rm(file, { force: true })))
    await rm(stagingDir, { recursive: true, force: true })
  }
}
