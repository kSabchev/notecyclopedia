/**
 * Times the API paths you wait on while studying: opening a page, saving it, searching, the course page list,
 * the references panel and a formula card. It seeds a course of realistic pages in the test database, runs each
 * request many times and prints the median and 95th percentile, then removes what it created.
 *
 *   pnpm --filter @nc/server bench            # 150 pages
 *   pnpm --filter @nc/server bench -- 400     # another course size
 *
 * Only NC_TEST_DATABASE_URL is used (a database whose name ends in _test); Claude and embeddings are not called.
 */
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const here = path.dirname(fileURLToPath(import.meta.url))
const rootEnv = path.resolve(here, '../../../.env')
const databaseUrl =
  process.env.NC_TEST_DATABASE_URL ||
  (existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')).NC_TEST_DATABASE_URL : undefined)
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('Set NC_TEST_DATABASE_URL to a dedicated database ending in _test')

process.env.DATABASE_URL = databaseUrl
process.env.BETTER_AUTH_SECRET ||= 'benchmark-secret-at-least-32-characters-long'
process.env.BETTER_AUTH_URL = 'http://localhost:5173'
process.env.WEB_ORIGIN = 'http://localhost:5173'
process.env.ANTHROPIC_API_KEY = ''
process.env.VOYAGE_API_KEY = ''

const PAGES = Number(process.argv[2]) || 150
const RUNS = 40

const [{ migrate }, { pool, db, schema }, { createApp }, jobs, { eq }] = await Promise.all([
  import('drizzle-orm/node-postgres/migrator'),
  import('./db'),
  import('./app'),
  import('./services/jobs'),
  import('drizzle-orm'),
])
await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
await migrate(db, { migrationsFolder: path.resolve(here, '../drizzle') })
await jobs.startJobs()

const server = createApp().listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
if (!address || typeof address === 'string') throw new Error('No server address')
const base = `http://127.0.0.1:${address.port}`
const origin = 'http://localhost:5173'

const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin },
  body: JSON.stringify({
    name: 'Benchmark',
    email: `bench-${crypto.randomUUID()}@example.test`,
    password: 'benchmark-password',
  }),
})
const cookie = signUp.headers
  .getSetCookie()
  .map((c) => c.split(';', 1)[0])
  .join('; ')
const userId = ((await signUp.json()) as { user: { id: string } }).user.id

const api = async (endpoint: string, init: RequestInit = {}) => {
  const response = await fetch(`${base}/api${endpoint}`, {
    ...init,
    headers: { cookie, origin, 'content-type': 'application/json', ...init.headers },
  })
  if (!response.ok)
    throw new Error(`${init.method ?? 'GET'} ${endpoint}: ${response.status} ${await response.text()}`)
  return response
}

try {
  // A course like a semester of lecture notes: sections, prose, formulas and links between pages.
  const course = (await (
    await api('/courses', { method: 'POST', body: JSON.stringify({ name: 'Bench' }) })
  ).json()) as {
    id: string
  }
  const words = 'orbit energy speed radius period transfer burn velocity anomaly plane node apsis'.split(' ')
  const sentence = (i: number) =>
    Array.from({ length: 18 }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(' ')
  const doc = (n: number, linkTo?: string) => ({
    type: 'doc',
    content: Array.from({ length: 8 }, (_, s) => [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: `Section ${n}.${s} ${words[s]}` }],
      },
      ...Array.from({ length: 4 }, (_, k) => ({
        type: 'paragraph',
        content: [
          { type: 'text', text: `${sentence(n + s + k)}. ${sentence(n * s + k)}.` },
          ...(linkTo && k === 0
            ? [{ type: 'text', text: ' see', marks: [{ type: 'link', attrs: { href: `/pages/${linkTo}` } }] }]
            : []),
        ],
      })),
      {
        type: 'formula',
        attrs: { latex: `v_{${s}}^2 = \\mu \\left(\\frac{2}{r} - \\frac{1}{a_{${n % 9}}}\\right)` },
      },
    ]).flat(),
  })
  const ids: string[] = []
  for (let n = 0; n < PAGES; n++) {
    const created = (await (
      await api('/pages', {
        method: 'POST',
        body: JSON.stringify({
          courseId: course.id,
          title: `Lecture ${n}`,
          type: 'lecture',
          content: doc(n, ids[0]),
        }),
      })
    ).json()) as { id: string }
    ids.push(created.id)
  }
  const target = ids[Math.floor(PAGES / 2)] as string
  const page = (await (await api(`/pages/${target}`)).json()) as {
    revision: number
    content: { content: { type: string; attrs?: { id?: string } }[] }
  }
  const formulaId = page.content.content.find((b) => b.type === 'formula')?.attrs?.id

  const time = async (name: string, run: (i: number) => Promise<unknown>) => {
    for (let i = 0; i < 3; i++) await run(i) // warm up
    const ms: number[] = []
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now()
      await run(i)
      ms.push(performance.now() - start)
    }
    ms.sort((a, b) => a - b)
    const at = (q: number) => (ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] as number).toFixed(1)
    console.log(`  ${name.padEnd(34)} median ${at(0.5).padStart(6)} ms   p95 ${at(0.95).padStart(6)} ms`)
  }

  console.log(
    `API timings, ${PAGES} pages of ~${(JSON.stringify(doc(1)).length / 1000) | 0} kB, ${RUNS} runs each:`,
  )
  await time('Open a page', () => api(`/pages/${target}`).then((r) => r.json()))
  await time('References panel', () => api(`/pages/${target}/references`).then((r) => r.json()))
  await time('Course page list', () => api(`/pages?courseId=${course.id}&limit=500`).then((r) => r.json()))
  if (formulaId)
    await time('Formula card', () =>
      api(`/formulas/related?pageId=${target}&nodeId=${formulaId}`).then((r) => r.json()),
    )
  await time('Search (a word)', () => api('/search?q=transfer').then((r) => r.json()))
  await time('Search (a phrase)', () =>
    api(`/search?q=${encodeURIComponent('energy speed radius')}`).then((r) => r.json()),
  )
  let revision = page.revision
  await time('Save a page', async (i) => {
    const saved = (await (
      await api(`/pages/${target}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: 'Lecture saved',
          type: 'lecture',
          lectureNumber: null,
          tags: [],
          content: doc(i + 1000, ids[0]),
          aiVisible: true,
          baseRevision: revision,
        }),
      })
    ).json()) as { revision: number }
    revision = saved.revision
  })
} finally {
  server.close()
  await jobs.stopJobs()
  // Saving queues a reindex job per page; drop the ones still waiting, or they hold up the tests' own jobs.
  const { sql } = await import('drizzle-orm')
  await db.execute(sql`DELETE FROM pgboss.job WHERE name = 'reindex-page' AND state = 'created'
    AND data->>'pageId' IN (SELECT id::text FROM pages WHERE created_by = ${userId})`)
  await db.delete(schema.courses).where(eq(schema.courses.createdBy, userId))
  await db.delete(schema.user).where(eq(schema.user.id, userId))
  await pool.end()
}
