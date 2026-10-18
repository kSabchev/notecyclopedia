import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './index'

const here = path.dirname(fileURLToPath(import.meta.url))

// pgvector must exist before the chunks table is created.
await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
await migrate(db, { migrationsFolder: path.resolve(here, '../../drizzle') })
console.log('Migrations applied')
await pool.end()
