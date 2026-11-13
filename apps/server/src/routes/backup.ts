import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import { eq } from 'drizzle-orm'
import { type Request, type RequestHandler, Router } from 'express'
import multer from 'multer'
import { db, schema } from '../db'
import { env } from '../env'
import { HttpError, me, sendAs } from '../http'
import { readBackupArchive, validateBackupPayloads } from '../services/backup/archive'
import { collectBackup } from '../services/backup/export'
import { MAX_ARCHIVE_SIZE } from '../services/backup/format'
import { restoreBackup } from '../services/backup/import'

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

/** When your last backup download finished (null: never). */
backup.get('/status', async (req, res) => {
  const [row] = await db
    .select({ lastBackupAt: schema.user.lastBackupAt })
    .from(schema.user)
    .where(eq(schema.user.id, me(req).id))
  res.json({ lastBackupAt: row?.lastBackupAt ?? null })
})

backup.get('/export', async (req, res) => {
  const user = me(req)
  const { manifestJson, files } = await collectBackup(user.id)
  const archive = new ZipArchive({ zlib: { level: 6 } })
  archive.on('error', (error) => res.destroy(error))
  archive.on('warning', (error) => res.destroy(error))
  sendAs(res, `notecyclopedia-backup-${new Date().toISOString().slice(0, 10)}.zip`, {
    type: 'application/zip',
  })
  res.setHeader('x-content-type-options', 'nosniff')
  // Counted as a backup once the whole archive has been sent.
  res.on('finish', () => {
    db.update(schema.user)
      .set({ lastBackupAt: new Date() })
      .where(eq(schema.user.id, user.id))
      .catch((error) => console.error('Could not record the backup time', error))
  })
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
      constants: data.constants.length,
      files: data.files.length,
      createdAt: data.createdAt,
    })
  })
})

backup.post('/import', receiveArchive, async (req, res) => {
  const user = me(req)
  await withUploadedArchive(req, async (archivePath) => {
    res.json(await restoreBackup(user.id, archivePath))
  })
})
