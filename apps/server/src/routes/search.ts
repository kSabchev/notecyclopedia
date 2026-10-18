import type { SearchHit } from '@nc/shared'
import { sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { memberCourseIds } from '../access'
import { db } from '../db'
import { me } from '../http'

export const search = Router()

search.get('/', async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(1).max(200) }).parse(req.query)
  const user = me(req)
  const ids = await memberCourseIds(user.id)
  const arr = ids.length
    ? sql`ARRAY[${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}]::uuid[]`
    : sql`ARRAY[]::uuid[]`
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
  const result = await db.execute<Record<string, unknown> & SearchHit & { rank: number }>(sql`
    (SELECT 'page' AS kind, id, title, course_id AS "courseId",
            ts_headline('simple', content_text, websearch_to_tsquery('simple', ${q}),
                        'MaxWords=24, MinWords=8, StartSel=«, StopSel=»') AS snippet,
            ts_rank(to_tsvector('simple', title || ' ' || content_text), websearch_to_tsquery('simple', ${q}))
              + CASE WHEN title ILIKE ${like} THEN 1 ELSE 0 END AS rank
       FROM pages
      WHERE course_id = ANY(${arr})
        AND (to_tsvector('simple', title || ' ' || content_text) @@ websearch_to_tsquery('simple', ${q})
             OR title ILIKE ${like})
      ORDER BY rank DESC LIMIT 20)
    UNION ALL
    (SELECT 'file', id, name, course_id, left(coalesce(text, ''), 160), 0.5
       FROM files WHERE course_id = ANY(${arr}) AND name ILIKE ${like} LIMIT 10)
    UNION ALL
    (SELECT 'calculator', id, name, course_id, '', 0.5
       FROM calculators
      WHERE (course_id = ANY(${arr}) OR (course_id IS NULL AND owner_id = ${user.id})) AND name ILIKE ${like}
      LIMIT 10)`)
  res.json(result.rows.sort((a, b) => b.rank - a.rank).map(({ rank: _r, ...hit }) => hit))
})
