import type { CalculatorIssue, CalculatorSpec } from './calculator'
import type { WidgetAttrs } from './widget'

export type Locale = 'en' | 'bg'
export type CourseRole = 'owner' | 'editor' | 'viewer'
export type PageType = 'lecture' | 'note' | 'seminar' | 'source'
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
  pageTitle: string
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
  kind: 'page' | 'file' | 'calculator'
  id: string
  title: string
  snippet: string
  courseId: string | null
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
