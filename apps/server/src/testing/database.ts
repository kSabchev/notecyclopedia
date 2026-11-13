import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'

/**
 * For integration tests: the dedicated test database. Only NC_TEST_DATABASE_URL is read from .env; the dev database
 * and API keys stay out of the tests. Undefined when it is not set, so the tests that need it skip.
 */
const rootEnv = path.resolve(import.meta.dirname, '../../../../.env')
export const testDatabaseUrl =
  process.env.NC_TEST_DATABASE_URL ||
  (existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')).NC_TEST_DATABASE_URL : undefined)

/**
 * Points the server at the test database (set before the first import of `./db` or `./env`) and never at Claude,
 * even when a key is set in the shell. `extra` sets more variables, such as AI_DAILY_TOKEN_LIMIT.
 */
export function useTestDatabase(url: string, extra: Record<string, string> = {}) {
  if (!new URL(url).pathname.endsWith('_test'))
    throw new Error('NC_TEST_DATABASE_URL must point to a dedicated database ending in _test')
  Object.assign(process.env, {
    DATABASE_URL: url,
    BETTER_AUTH_SECRET: 'dedicated-integration-test-secret-at-least-32',
    BETTER_AUTH_URL: 'http://localhost:5173',
    WEB_ORIGIN: 'http://localhost:5173',
    ANTHROPIC_API_KEY: '',
    VOYAGE_API_KEY: '',
    ...extra,
  })
}

/** Applies the migrations. Test files run in parallel processes; a lock keeps two of them from migrating at once. */
export async function migrateTestDatabase() {
  const [{ migrate }, { pool, db }] = await Promise.all([
    import('drizzle-orm/node-postgres/migrator'),
    import('../db'),
  ])
  const lock = await pool.connect()
  try {
    await lock.query('SELECT pg_advisory_lock(74310001)')
    await lock.query('CREATE EXTENSION IF NOT EXISTS vector')
    await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, '../../drizzle') })
  } finally {
    await lock.query('SELECT pg_advisory_unlock(74310001)')
    lock.release()
  }
}
