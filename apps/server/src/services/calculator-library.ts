import type { CalculatorSpec } from '@nc/shared'
import { sql } from 'drizzle-orm'
import { memberCourseIds } from '../access'
import { db } from '../db'
import type { CalculatorLibrary, LibraryCalculator } from './claude'
import { anyTermQuery } from './search-query'

/**
 * The calculators a user can use in chat: those of their courses and their personal ones. Search matches
 * any keyword in the name or the spec (labels, description, theory), ranked by how many match.
 */
export function calculatorLibrary(userId: string): CalculatorLibrary {
  const visible = async () => {
    const ids = await memberCourseIds(userId)
    const courses = ids.length
      ? sql`ARRAY[${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )}]::uuid[]`
      : sql`ARRAY[]::uuid[]`
    return sql`(course_id = ANY(${courses}) OR (course_id IS NULL AND owner_id = ${userId}))`
  }
  type Row = { id: string; name: string; spec: CalculatorSpec }

  return {
    async find(query) {
      const terms = anyTermQuery(query)
      if (!terms) return []
      const like = `%${query.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`
      const document = sql`to_tsvector('simple', name || ' ' || spec::text)`
      const result = await db.execute<Row>(sql`
        SELECT id, name, spec FROM calculators
        WHERE ${await visible()}
          AND (${document} @@ to_tsquery('simple', ${terms}) OR name ILIKE ${like})
        ORDER BY ts_rank(${document}, to_tsquery('simple', ${terms}))
                 + CASE WHEN name ILIKE ${like} THEN 1 ELSE 0 END DESC,
                 updated_at DESC
        LIMIT 5`)
      return result.rows satisfies LibraryCalculator[]
    },
    async get(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null
      const result = await db.execute<Row>(sql`
        SELECT id, name, spec FROM calculators WHERE id = ${id} AND ${await visible()}`)
      return result.rows[0] ?? null
    },
  }
}
