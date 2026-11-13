import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import unzipper from 'unzipper'
import { HttpError } from '../../http'
import {
  type BackupData,
  MAX_FILE_SIZE,
  MAX_MANIFEST_SIZE,
  MAX_TOTAL_SIZE,
  allowedExtension,
  backupSchema,
} from './format'

/** Reading and checking a backup archive. */

export function failInvalidBackup(): never {
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
      (calculator.sourcePageId !== null && !pageIds.has(calculator.sourcePageId)) ||
      (calculator.lectureNumber !== null && calculator.courseId === null)
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

export async function readEntry(entry: unzipper.File, expectedSize: number, destination: Writable) {
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

export function formatManifest(data: BackupData) {
  return JSON.stringify(data)
}

export function validateBackupManifest(manifestJson: string) {
  return backupSchema.safeParse(JSON.parse(manifestJson))
}
