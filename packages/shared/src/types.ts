import type { CalculatorIssue, CalculatorSpec } from './calculator'
import type { PageType } from './pages'
import type { WidgetAttrs } from './widget'

export type Locale = 'en' | 'bg'
export type CourseRole = 'owner' | 'editor' | 'viewer'
export type FileStatus = 'uploaded' | 'processing' | 'indexed' | 'failed'
/** AI portal modes, in the order they are offered. */
export const AI_MODES = ['ask', 'tutor', 'check', 'summarize', 'solve', 'calculator'] as const
export type AiMode = (typeof AI_MODES)[number]

export interface Course {
  id: string
  name: string
  color: string
  description: string | null
  role: CourseRole
  createdAt: string
}

export interface PageSummary {
  id: string
  courseId: string
  title: string
  type: PageType
  lectureNumber: number | null
  tags: string[]
  updatedAt: string
  revision: number
}

/** TipTap / ProseMirror JSON document. */
export type DocJSON = { type: 'doc'; content?: unknown[] }

export interface Page extends PageSummary {
  content: DocJSON
  aiVisible: boolean
  createdBy: string
  updatedBy: string
}

export interface PageRevision {
  id: string
  revision: number
  title: string
  message: string | null
  authorName: string
  createdAt: string
}

export interface FormulaVariable {
  symbol: string
  meaning: string
  unit?: string
}

export interface Formula {
  id: string
  pageId: string
  /** The formula block's id in its page; null for formulas saved before blocks had ids. */
  nodeId: string | null
  pageTitle: string
  courseId: string
  /** The lecture number of its page (for an example problem, the lecture it practises). */
  lectureNumber: number | null
  pageType: PageType
  label: string | null
  latex: string
  description: string | null
  pinned: boolean
}

export interface FileAsset {
  id: string
  courseId: string
  pageId: string | null
  name: string
  mime: string
  size: number
  status: FileStatus
  error: string | null
  createdAt: string
}

export interface Calculator {
  id: string
  courseId: string | null
  name: string
  spec: CalculatorSpec
  origin: 'manual' | 'ai'
  sourcePageId: string | null
  updatedAt: string
}

export interface CourseConstant {
  id: string
  courseId: string
  key: string
  name: string
  symbol: string
  value: number
  unit: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface SearchHit {
  /** A term is a heading of a page: `id` is the page, `anchor` the heading. */
  kind: 'page' | 'term' | 'file' | 'calculator'
  id: string
  title: string
  snippet: string
  courseId: string | null
  anchor: string | null
}

/** A link to a page from another page, shown as "Referenced by" on the target. */
export interface PageReference {
  sourcePageId: string
  sourceTitle: string
  sourceType: PageType
  /** The heading on the target page it points to; null for the whole page. */
  targetNodeId: string | null
}

export interface AiCitation {
  sourceType: 'page' | 'file'
  sourceId: string
  title: string
}

/** A photo sent with a chat message, e.g. handwritten working to check. Downscaled by the browser. */
export interface AiAttachment {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  /** Base64 without a data: prefix. */
  data: string
}

/** Tokens and estimated cost of one answer, summed over every Claude call it took. */
export interface AiUsage {
  /** The model that answered; several when one answer used more than one. */
  models: string[]
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Null when the pricing of a model is unknown. */
  costUsd: number | null
}

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: AiCitation[]
  /** Calculators made from the answer (several when it covers independent calculations). */
  calculators: CalculatorSpec[]
  /** Interactive blocks the AI showed in this answer, e.g. orbit diagrams and calculator runs. */
  widgets: WidgetAttrs[]
  attachments: AiAttachment[]
  usage: AiUsage | null
  createdAt: string
}

export interface AiThread {
  id: string
  title: string
  mode: AiMode
  updatedAt: string
}

/** Server-sent events emitted by POST /api/ai/chat */
export type AiStreamEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'citations'; citations: AiCitation[] }
  | { type: 'text'; text: string }
  | { type: 'calculator'; spec: CalculatorSpec }
  | { type: 'widget'; widget: WidgetAttrs }
  | { type: 'usage'; usage: AiUsage }
  | { type: 'error'; message: string }
  | { type: 'done'; messageId: string }

/** Claude's check of a calculator's formulas, theory and explanations, with an optional corrected version. */
export interface CalculatorReview {
  findings: {
    severity: 'error' | 'warning' | 'note'
    /** The input or output concerned, if any. */
    key: string | null
    message: string
  }[]
  /** The corrected calculator; null when nothing needs to change. */
  revised: CalculatorSpec | null
  /** Automatic checks of the corrected calculator (what would still need attention). */
  revisedChecks: CalculatorIssue[]
  usage: AiUsage | null
}

/** An expansion of a daily question, made on request. */
export type DailyExpansionKind = 'story' | 'advanced'

/** A day's study question about one topic of a course, with its answer and optional expansions. */
export interface DailyQuestion {
  id: string
  /** The user's local date, YYYY-MM-DD. */
  day: string
  courseId: string
  /** The page it is about; null when that page was deleted. */
  pageId: string | null
  pageTitle: string
  /** The heading (term) it is about, if any. */
  nodeId: string | null
  topic: string
  question: string
  /** Markdown with LaTeX. */
  answer: string
  /** What the answer adds beyond the notes; null when it stays within them. */
  beyondNotes: string | null
  expansions: {
    story?: string
    advanced?: { question: string; answer: string }
  }
  usage: AiUsage | null
  createdAt: string
}

/** "Where was I" on the home page: what you read and asked recently, from your own activity (no AI). */
export interface WhereWasI {
  /** Pages you opened, most recent first. */
  viewed: { id: string; title: string; courseId: string; type: PageType; visitedAt: string }[]
  /** Your latest AI sessions; tutor sessions are the ones you can pick up. */
  threads: { id: string; title: string; mode: AiMode; updatedAt: string }[]
  /** Pages your recent questions were answered from, most asked first. */
  topics: { pageId: string; title: string; courseId: string; questions: number; lastAskedAt: string }[]
}

/** One thing to do on a day of a revision plan. */
export interface ExamPlanItem {
  id: string
  /** The page to revise; null for a free task (e.g. a mock exam), or when the page was deleted. */
  pageId: string | null
  /** Kept so the plan still names a deleted page. */
  pageTitle: string | null
  /** What to do, e.g. "Rework the Hohmann examples". */
  focus: string
  done: boolean
}

/** One study day of a revision plan. */
export interface ExamPlanDay {
  /** YYYY-MM-DD. */
  date: string
  items: ExamPlanItem[]
}

/** How well the student knows a page before revising, given when a plan is made. */
export type Confidence = 'know' | 'shaky' | 'new'

/** A revision plan for an exam: one entry per study day, editable after it is made. */
export interface ExamPlan {
  id: string
  courseId: string
  title: string
  /** YYYY-MM-DD. */
  examDate: string
  /** Weekdays to study on, 0 = Sunday … 6 = Saturday; catching up and moving tasks keep to them. */
  studyWeekdays: number[]
  /** False when paused: kept, but left out of today's revision and of the duplicate warning. */
  active: boolean
  days: ExamPlanDay[]
  usage: AiUsage | null
  createdAt: string
  updatedAt: string
}

/** A copy of a plan another course member sent you, waiting to be accepted or declined. */
export interface PlanShare {
  id: string
  fromName: string
  courseId: string
  title: string
  examDate: string
  /** Number of tasks in the copy. */
  tasks: number
  createdAt: string
}

/** Today's tasks of a plan whose exam is ahead, for the home page. */
export interface TodaysRevision {
  planId: string
  title: string
  examDate: string
  items: ExamPlanItem[]
  /** Unfinished tasks from earlier days. */
  overdue: number
}

/** Two or three questions to check an explanation was understood, made only on request. */
export interface QuickCheck {
  questions: { question: string; answer: string }[]
  usage: AiUsage | null
}
