import { chunkText } from '@nc/shared'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db'
import { embed } from './embeddings'

/** Replace the retrieval chunks of one page or file. */
export async function reindexSource(
  sourceType: 'page' | 'file',
  sourceId: string,
  courseId: string,
  title: string,
  text: string,
) {
  const parts = text.trim() ? chunkText(text).map((c) => `${title}\n\n${c}`) : []
  const vectors = await embed(parts, 'document').catch((e) => {
    console.warn('Embedding failed, storing chunks without vectors:', (e as Error).message)
    return null
  })
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.chunks)
      .where(and(eq(schema.chunks.sourceType, sourceType), eq(schema.chunks.sourceId, sourceId)))
    if (parts.length)
      await tx.insert(schema.chunks).values(
        parts.map((t, i) => ({
          sourceType,
          sourceId,
          courseId,
          position: i,
          text: t,
          embedding: vectors?.[i] ?? null,
        })),
      )
  })
}

export async function removeSource(sourceType: 'page' | 'file', sourceId: string) {
  await db
    .delete(schema.chunks)
    .where(and(eq(schema.chunks.sourceType, sourceType), eq(schema.chunks.sourceId, sourceId)))
}
