import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '../env'
import * as schema from './schema'

export const pool = new pg.Pool({ connectionString: env.databaseUrl })
export const db = drizzle(pool, { schema })
export { schema }

/** A unique index refused the write. Drizzle wraps the Postgres error, so the code is on `cause`. */
export const isUniqueViolation = (e: unknown) => {
  const error = e as { code?: string; cause?: { code?: string } } | null
  return error?.code === '23505' || error?.cause?.code === '23505'
}
