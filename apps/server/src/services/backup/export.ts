import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import { asc, eq, inArray, or } from 'drizzle-orm'
import { memberCourseIds } from '../../access'
import { db, schema } from '../../db'
import { env } from '../../env'
import { HttpError } from '../../http'
import { formatManifest, validateBackupManifest } from './archive'
import { type BackupData, FORMAT, MAX_FILE_SIZE, MAX_MANIFEST_SIZE, MAX_TOTAL_SIZE, VERSION } from './format'

/**
 * Everything a user can back up: their courses with pages, revisions, constants and uploads, and their own
 * calculators. Checks every uploaded file is still on disk, so the archive is complete.
 */
export async function collectBackup(userId: string) {
  const courseIds = await memberCourseIds(userId)
  const courses = courseIds.length
    ? await db
        .select({
          id: schema.courses.id,
          name: schema.courses.name,
          color: schema.courses.color,
          description: schema.courses.description,
          createdAt: schema.courses.createdAt,
        })
        .from(schema.courseMembers)
        .innerJoin(schema.courses, eq(schema.courses.id, schema.courseMembers.courseId))
        .where(eq(schema.courseMembers.userId, userId))
        .orderBy(asc(schema.courseMembers.sortOrder), asc(schema.courses.name))
    : []
  const pages = courseIds.length
    ? await db
        .select()
        .from(schema.pages)
        .where(inArray(schema.pages.courseId, courseIds))
        .orderBy(asc(schema.pages.courseId), asc(schema.pages.sortOrder), asc(schema.pages.id))
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
        // Calculators are personal: yours only, whatever their course tag.
        eq(schema.calculators.ownerId, userId),
      ),
    )
  const constants = courseIds.length
    ? await db
        .select()
        .from(schema.courseConstants)
        .where(inArray(schema.courseConstants.courseId, courseIds))
    : []

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
      ({
        id,
        courseId,
        title,
        type,
        lectureNumber,
        tags,
        content,
        aiVisible,
        revision,
        createdAt,
        updatedAt,
      }) => ({
        id,
        courseId,
        title,
        type,
        lectureNumber,
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
      ({
        id,
        courseId,
        name,
        spec,
        origin,
        sourcePageId,
        lectureNumber,
        archivedAt,
        createdAt,
        updatedAt,
      }) => ({
        id,
        // A tag of a course not in the backup (one you left) is dropped.
        courseId: courseId && courseIds.includes(courseId) ? courseId : null,
        archivedAt,
        name,
        spec,
        origin,
        sourcePageId: sourcePageId && pageIds.includes(sourcePageId) ? sourcePageId : null,
        lectureNumber: courseId && courseIds.includes(courseId) ? lectureNumber : null,
        createdAt,
        updatedAt,
      }),
    ),
    constants: constants.map(
      ({ id, courseId, key, name, symbol, value, unit, description, createdAt, updatedAt }) => ({
        id,
        courseId,
        key,
        name,
        symbol,
        value,
        unit,
        description,
        createdAt,
        updatedAt,
      }),
    ),
    files: files.map(({ id, courseId, pageId, name, mime, size, lectureNumber, createdAt }) => ({
      id,
      courseId,
      pageId,
      name,
      mime,
      size,
      lectureNumber,
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
  return { manifestJson, files }
}
