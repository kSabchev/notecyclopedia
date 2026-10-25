import type { AiCitation, CalculatorSpec, DocJSON } from '@nc/shared'
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

// ---------- Better Auth core tables ----------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  locale: text('locale').notNull().default('bg'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ---------- Workbook ----------

/** A course is the unit of sharing: classmates are invited as members. */
export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#1F3FBF'),
  description: text('description'),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const courseMembers = pgTable(
  'course_members',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.courseId, t.userId] })],
)

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type', { enum: ['lecture', 'note', 'seminar', 'source'] })
      .notNull()
      .default('note'),
    lectureNumber: integer('lecture_number'),
    sortOrder: integer('sort_order').notNull().default(0),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    content: jsonb('content').$type<DocJSON>().notNull(),
    contentText: text('content_text').notNull().default(''),
    aiVisible: boolean('ai_visible').notNull().default(true),
    revision: integer('revision').notNull().default(1),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('pages_course_idx').on(t.courseId),
    // 'simple' config works for both Bulgarian and English (no stemming, no stop words).
    index('pages_fts_idx').using('gin', sql`to_tsvector('simple', ${t.title} || ' ' || ${t.contentText})`),
  ],
)

export const pageRevisions = pgTable(
  'page_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    title: text('title').notNull(),
    content: jsonb('content').$type<DocJSON>().notNull(),
    message: text('message'),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('page_revisions_page_rev_idx').on(t.pageId, t.revision)],
)

/** Formula blocks extracted from pages on save — powers the formula index and "pinned formulas". */
export const formulas = pgTable(
  'formulas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label'),
    latex: text('latex').notNull(),
    description: text('description'),
    pinned: boolean('pinned').notNull().default(false),
  },
  (t) => [index('formulas_page_idx').on(t.pageId)],
)

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    storageKey: text('storage_key').notNull(),
    status: text('status', { enum: ['uploaded', 'processing', 'indexed', 'failed'] })
      .notNull()
      .default('uploaded'),
    error: text('error'),
    text: text('text'),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('files_course_idx').on(t.courseId), index('files_page_idx').on(t.pageId)],
)

export const calculators = pgTable('calculators', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** null = personal calculator, visible only to its owner */
  courseId: uuid('course_id').references(() => courses.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id),
  name: text('name').notNull(),
  spec: jsonb('spec').$type<CalculatorSpec>().notNull(),
  origin: text('origin', { enum: ['manual', 'ai'] })
    .notNull()
    .default('manual'),
  sourcePageId: uuid('source_page_id').references(() => pages.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

/** Text chunks of pages and files for retrieval. `embedding` stays null until an embedding key is configured. */
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: text('source_type', { enum: ['page', 'file'] }).notNull(),
    sourceId: uuid('source_id').notNull(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }),
  },
  (t) => [
    index('chunks_source_idx').on(t.sourceType, t.sourceId),
    index('chunks_fts_idx').using('gin', sql`to_tsvector('simple', ${t.text})`),
    index('chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
)

export const aiThreads = pgTable('ai_threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  mode: text('mode', { enum: ['ask', 'summarize', 'solve', 'calculator'] }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => aiThreads.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<AiCitation[]>().notNull().default([]),
    calculator: jsonb('calculator').$type<CalculatorSpec>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('ai_messages_thread_idx').on(t.threadId)],
)

export const claudeApiCalls = pgTable(
  'claude_api_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    operation: text('operation').notNull(),
    model: text('model').notNull(),
    request: jsonb('request').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ['succeeded', 'failed'] }).notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 14, scale: 8 }),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('claude_api_calls_created_idx').on(t.createdAt),
    index('claude_api_calls_user_idx').on(t.userId),
  ],
)
