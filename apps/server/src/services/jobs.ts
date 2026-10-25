import path from 'node:path'
import { eq } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { db, schema } from '../db'
import { env } from '../env'
import { extractFileText } from './extract'
import { reindexSource } from './indexing'

const INGEST = 'ingest-file'
let boss: PgBoss | null = null

export async function startJobs() {
  boss = new PgBoss(env.databaseUrl)
  boss.on('error', (e) => console.error('[jobs]', e))
  await boss.start()
  await boss.createQueue(INGEST)
  await boss.work<{ fileId: string }>(INGEST, async (jobs) => {
    for (const job of jobs) await ingestFile(job.data.fileId)
  })
}

export async function queueIngest(fileId: string) {
  if (!boss) throw new Error('Job queue not started')
  await boss.send(INGEST, { fileId })
}

async function ingestFile(fileId: string) {
  const [file] = await db.select().from(schema.files).where(eq(schema.files.id, fileId))
  if (!file) return
  await db.update(schema.files).set({ status: 'processing', error: null }).where(eq(schema.files.id, fileId))
  try {
    const text = await extractFileText(
      path.join(env.uploadDir, file.storageKey),
      file.mime,
      file.name,
      file.uploadedBy,
    )
    await db.update(schema.files).set({ text }).where(eq(schema.files.id, fileId))
    await reindexSource('file', file.id, file.courseId, file.name, text)
    await db.update(schema.files).set({ status: 'indexed' }).where(eq(schema.files.id, fileId))
  } catch (e) {
    console.error('[ingest]', file.name, e)
    await db
      .update(schema.files)
      .set({ status: 'failed', error: (e as Error).message.slice(0, 500) })
      .where(eq(schema.files.id, fileId))
  }
}

export async function stopJobs() {
  await boss?.stop()
}
