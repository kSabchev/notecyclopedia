import assert from 'node:assert/strict'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { finished } from 'node:stream/promises'
import { test } from 'node:test'
import { ZipArchive } from 'archiver'
import { readBackupArchive, validateBackupManifest, validateBackupPayloads } from './backup'

const createdAt = '2026-01-01T00:00:00.000Z'
const emptyBackup = () => ({
  format: 'notecyclopedia-backup',
  version: 1,
  createdAt,
  courses: [],
  pages: [],
  calculators: [],
  files: [],
})

async function makeArchive(
  t: { after: (fn: () => void | Promise<void>) => void },
  manifest: object,
  assets: Record<string, Buffer> = {},
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'notecyclopedia-backup-test-'))
  t.after(() => rm(tempDir, { recursive: true, force: true }))
  const filePath = path.join(tempDir, 'backup.zip')
  const output = createWriteStream(filePath)
  const written = finished(output)
  const archive = new ZipArchive()
  archive.pipe(output)
  archive.append(JSON.stringify(manifest), { name: 'manifest.json' })
  for (const [name, data] of Object.entries(assets)) archive.append(data, { name })
  await Promise.all([archive.finalize(), written])
  return filePath
}

test('accepts a valid empty backup', async (t) => {
  const filePath = await makeArchive(t, emptyBackup())
  const result = await readBackupArchive(filePath)
  assert.equal(result.data.courses.length, 0)
  assert.equal(result.entries.size, 1)
})

test('validates export manifests after serializing database date values', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const manifest = {
    ...emptyBackup(),
    createdAt,
    courses: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Physics',
        color: '#1F3FBF',
        description: null,
        createdAt,
      },
    ],
  }

  assert.equal(validateBackupManifest(JSON.stringify(manifest)).success, true)
})

test('preserves lecture numbers and defaults them for older backups', () => {
  const id = '22222222-2222-4222-8222-222222222222'
  const courseId = '11111111-1111-4111-8111-111111111111'
  const page = {
    id,
    courseId,
    title: 'Natural environment',
    type: 'lecture',
    tags: [],
    content: { type: 'doc', content: [] },
    aiVisible: true,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
    revisions: [
      {
        revision: 1,
        title: 'Natural environment',
        content: { type: 'doc', content: [] },
        message: 'Created',
        createdAt,
      },
    ],
  }
  const numbered = validateBackupManifest(
    JSON.stringify({ ...emptyBackup(), pages: [{ ...page, lectureNumber: 3 }] }),
  )
  const legacy = validateBackupManifest(JSON.stringify({ ...emptyBackup(), pages: [page] }))

  assert.equal(numbered.success, true)
  if (numbered.success) assert.equal(numbered.data.pages[0]?.lectureNumber, 3)
  assert.equal(legacy.success, true)
  if (legacy.success) assert.equal(legacy.data.pages[0]?.lectureNumber, null)
})

test('rejects unsupported backup formats', async (t) => {
  const filePath = await makeArchive(t, { ...emptyBackup(), format: 'other' })
  await assert.rejects(readBackupArchive(filePath), { status: 400 })
})

test('rejects archive entries outside the backup structure', async (t) => {
  const filePath = await makeArchive(t, emptyBackup(), { '../unexpected.txt': Buffer.from('no') })
  await assert.rejects(readBackupArchive(filePath), { status: 400 })
})

test('validates attachment contents and their manifest sizes', async (t) => {
  const courseId = '11111111-1111-4111-8111-111111111111'
  const fileId = '22222222-2222-4222-8222-222222222222'
  const contents = Buffer.from('backup attachment')
  const manifest = {
    ...emptyBackup(),
    courses: [{ id: courseId, name: 'Physics', color: '#1F3FBF', description: null, createdAt }],
    files: [
      {
        id: fileId,
        courseId,
        pageId: null,
        name: 'notes.pdf',
        mime: 'application/pdf',
        size: contents.length,
        entryPath: `files/${fileId}`,
        createdAt,
      },
    ],
  }
  const filePath = await makeArchive(t, manifest, { [`files/${fileId}`]: contents })
  const result = await readBackupArchive(filePath)
  await validateBackupPayloads(result.data, result.entries)
})

test('rejects attachment size mismatches before import', async (t) => {
  const courseId = '11111111-1111-4111-8111-111111111111'
  const fileId = '22222222-2222-4222-8222-222222222222'
  const contents = Buffer.from('backup attachment')
  const manifest = {
    ...emptyBackup(),
    courses: [{ id: courseId, name: 'Physics', color: '#1F3FBF', description: null, createdAt }],
    files: [
      {
        id: fileId,
        courseId,
        pageId: null,
        name: 'notes.pdf',
        mime: 'application/pdf',
        size: contents.length + 1,
        entryPath: `files/${fileId}`,
        createdAt,
      },
    ],
  }
  const filePath = await makeArchive(t, manifest, { [`files/${fileId}`]: contents })
  await assert.rejects(readBackupArchive(filePath), { status: 400 })
})
