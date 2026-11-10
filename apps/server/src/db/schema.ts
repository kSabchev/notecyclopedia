import {
  AI_MODES,
  type AiAttachment,
  type AiCitation,
  type AiUsage,
  type CalculatorSpec,
  DEFAULT_TIME_ZONE,
  type DailyQuestion,
  type DocJSON,
  type ExamPlan,
  PAGE_TYPES,
  type PlanFile,
  type QuickCheck,
  type WidgetAttrs,
} from '@nc/shared'
import { sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
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
  /** IANA time zone that defines the user's "day" for daily topics and quizzes. */
  timezone: text('timezone').notNull().default(DEFAULT_TIME_ZONE),
  /** When a backup download last finished, for the reminder on the Backup page. */
  lastBackupAt: timestamp('last_backup_at'),
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
    type: text('type', { enum: PAGE_TYPES }).notNull().default('note'),
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
    // Full-text search uses the column `search_vector`, which exists only in the database (migration 0014):
    // to_tsvector('simple', title || ' ' || content_text), generated and stored, with a GIN index. It is left
    // out of this schema so page queries never fetch or return it. 'simple' works for Bulgarian and English
    // (no stemming, no stop words).
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
    /** The formula block's `id` attribute in the page document; rows are upserted by it, so `id` stays stable. */
    nodeId: text('node_id'),
    position: integer('position').notNull(),
    label: text('label'),
    latex: text('latex').notNull(),
    description: text('description'),
    /** The page's own "pinned" flag, from before pins were per user (see formulaPins); no longer shown. */
    pinned: boolean('pinned').notNull().default(false),
  },
  (t) => [
    index('formulas_page_idx').on(t.pageId),
    uniqueIndex('formulas_page_node_idx').on(t.pageId, t.nodeId),
  ],
)

/** Headings of pages: terms that can be searched and referenced. Upserted by the heading's `id` attribute. */
export const terms = pgTable(
  'terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    level: integer('level').notNull(),
  },
  (t) => [
    uniqueIndex('terms_page_node_idx').on(t.pageId, t.nodeId),
    index('terms_fts_idx').using('gin', sql`to_tsvector('simple', ${t.text})`),
  ],
)

/** In-app links between pages: from a page to another page, or to a term (heading) on it. */
export const pageReferences = pgTable(
  'page_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourcePageId: uuid('source_page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    targetPageId: uuid('target_page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    /** The heading id on the target page; null for a link to the whole page. */
    targetNodeId: text('target_node_id'),
  },
  (t) => [
    index('page_references_source_idx').on(t.sourcePageId),
    index('page_references_target_idx').on(t.targetPageId),
  ],
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
    /** Set when this upload is the original of lecture N of its course; pages with that number are its parts. */
    lectureNumber: integer('lecture_number'),
    uploadedBy: text('uploaded_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('files_course_idx').on(t.courseId),
    index('files_page_idx').on(t.pageId),
    // One original per lecture of a course.
    uniqueIndex('files_course_lecture_idx').on(t.courseId, t.lectureNumber),
  ],
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
  /** The lecture of its course this calculator belongs to; only a course calculator has one. */
  lectureNumber: integer('lecture_number'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const courseConstants = pgTable(
  'course_constants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    symbol: text('symbol').notNull(),
    value: doublePrecision('value').notNull(),
    unit: text('unit').notNull(),
    description: text('description'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('course_constants_course_key_idx').on(t.courseId, t.key),
    index('course_constants_course_idx').on(t.courseId),
  ],
)

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
  mode: text('mode', { enum: AI_MODES }).notNull(),
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
    /** Calculators made from the answer, by Build calculator or on request. */
    calculators: jsonb('calculators').$type<CalculatorSpec[]>().notNull().default([]),
    /** Interactive blocks shown with the answer (e.g. orbit diagrams from the show_orbit tool). */
    widgets: jsonb('widgets').$type<WidgetAttrs[]>().notNull().default([]),
    /** Photos sent with a user message. */
    attachments: jsonb('attachments').$type<AiAttachment[]>().notNull().default([]),
    /** Tokens and estimated cost of an assistant message. */
    usage: jsonb('usage').$type<AiUsage>(),
    /** Questions to check the answer was understood, made on request and kept. */
    quickCheck: jsonb('quick_check').$type<QuickCheck>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('ai_messages_thread_idx').on(t.threadId)],
)

/**
 * Study questions about topics of a user's courses: the first of a local day is "today's question", and more
 * can be made on demand.
 */
/**
 * Formulas each user pinned to their home page. Pins are personal (not part of the page), keyed by the formula
 * block's id in its page, so a pin survives edits of the page and goes when the formula or page is removed.
 */
export const formulaPins = pgTable(
  'formula_pins',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId, t.nodeId] })],
)

/** Links a user added to their Useful links page (the built-in ones live in the web app). */
export const userLinks = pgTable(
  'user_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    url: text('url').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('user_links_user_idx').on(t.userId)],
)

/** When each user last opened each page, for "Where was I" on the home page. */
export const pageVisits = pgTable(
  'page_visits',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    visitedAt: timestamp('visited_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.pageId] }),
    index('page_visits_user_visited_idx').on(t.userId, t.visitedAt),
  ],
)

/** A revision plan for an exam, proposed by Claude in one call and then edited by the user. */
export const examPlans = pgTable(
  'exam_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** YYYY-MM-DD. */
    examDate: text('exam_date').notNull(),
    /** Weekdays to study on, 0 = Sunday … 6 = Saturday. */
    studyWeekdays: jsonb('study_weekdays').$type<number[]>().notNull().default([0, 1, 2, 3, 4, 5, 6]),
    /** False when paused: kept, but left out of today's revision and of the duplicate warning. */
    active: boolean('active').notNull().default(true),
    days: jsonb('days').$type<ExamPlan['days']>().notNull().default([]),
    usage: jsonb('usage').$type<AiUsage>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('exam_plans_user_idx').on(t.userId)],
)

/**
 * A copy of a plan sent to another member of its course, waiting until they accept it (it becomes their own plan)
 * or decline it. The copy is taken when it is sent, so later edits by the sender do not change it.
 */
export const planShares = pgTable(
  'plan_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromUserId: text('from_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    toUserId: text('to_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    plan: jsonb('plan').$type<PlanFile>().notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('plan_shares_to_idx').on(t.toUserId)],
)

export const dailyQuestions = pgTable(
  'daily_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The user's local date, YYYY-MM-DD. */
    day: text('day').notNull(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id').references(() => pages.id, { onDelete: 'set null' }),
    /** Kept so the archive still names the page after it is deleted. */
    pageTitle: text('page_title').notNull(),
    /** The heading (term) the question is about, if any. */
    nodeId: text('node_id'),
    topic: text('topic').notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    beyondNotes: text('beyond_notes'),
    expansions: jsonb('expansions').$type<DailyQuestion['expansions']>().notNull().default({}),
    usage: jsonb('usage').$type<AiUsage>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('daily_questions_user_day_idx').on(t.userId, t.day)],
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
    // Covers per-user lookups and the daily budget check (user + time window).
    index('claude_api_calls_user_created_idx').on(t.userId, t.createdAt),
  ],
)
