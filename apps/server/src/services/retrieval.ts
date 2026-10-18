import type { AiCitation } from '@nc/shared'
import { sql } from 'drizzle-orm'
import { memberCourseIds } from '../access'
import { db } from '../db'
import { embed } from './embeddings'

export interface RetrievedChunk extends AiCitation {
  text: string
}

/**
 * Hybrid retrieval: keyword search (works for Bulgarian and English via the 'simple' config)
 * plus vector search when embeddings are configured, merged with reciprocal-rank fusion.
 */
export async function retrieve(
  query: string,
  userId: string,
  opts: { courseIds?: string[]; limit?: number } = {},
): Promise<RetrievedChunk[]> {
  const allowed = await memberCourseIds(userId)
  const courseIds = opts.courseIds?.length ? opts.courseIds.filter((c) => allowed.includes(c)) : allowed
  if (!courseIds.length || !query.trim()) return []
  const limit = opts.limit ?? 8
  const ids = sql`ARRAY[${sql.join(
    courseIds.map((c) => sql`${c}`),
    sql`, `,
  )}]::uuid[]`

  type Row = { id: string; source_type: 'page' | 'file'; source_id: string; text: string }
  const keyword = await db.execute<Row>(sql`
    SELECT id, source_type, source_id, text FROM chunks
    WHERE course_id = ANY(${ids})
      AND to_tsvector('simple', text) @@ websearch_to_tsquery('simple', ${query})
    ORDER BY ts_rank(to_tsvector('simple', text), websearch_to_tsquery('simple', ${query})) DESC
    LIMIT ${limit * 2}`)

  let semantic: Row[] = []
  const qv = await embed([query], 'query').catch(() => null)
  if (qv?.[0]) {
    const vec = `[${qv[0].join(',')}]`
    const r = await db.execute<Row>(sql`
      SELECT id, source_type, source_id, text FROM chunks
      WHERE course_id = ANY(${ids}) AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vec}::vector
      LIMIT ${limit * 2}`)
    semantic = r.rows
  }

  const score = new Map<string, { row: Row; s: number }>()
  for (const list of [keyword.rows, semantic]) {
    list.forEach((row, i) => {
      const cur = score.get(row.id) ?? { row, s: 0 }
      cur.s += 1 / (60 + i)
      score.set(row.id, cur)
    })
  }
  const top = [...score.values()]
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.row)
  if (!top.length) return []

  const titles = await db.execute<{ id: string; title: string }>(sql`
    SELECT id, title FROM pages WHERE id = ANY(${sql`ARRAY[${sql.join(
      top.map((t) => sql`${t.source_id}`),
      sql`, `,
    )}]::uuid[]`})
    UNION ALL
    SELECT id, name AS title FROM files WHERE id = ANY(${sql`ARRAY[${sql.join(
      top.map((t) => sql`${t.source_id}`),
      sql`, `,
    )}]::uuid[]`})`)
  const titleOf = new Map(titles.rows.map((t) => [t.id, t.title]))
  return top.map((t) => ({
    sourceType: t.source_type,
    sourceId: t.source_id,
    title: titleOf.get(t.source_id) ?? 'Untitled',
    text: t.text,
  }))
}
