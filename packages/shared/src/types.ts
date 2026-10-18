import type { CalculatorSpec } from './calculator'

export type Locale = 'en' | 'bg'
export type CourseRole = 'owner' | 'editor' | 'viewer'
export type PageType = 'lecture' | 'note' | 'seminar' | 'source'
export type FileStatus = 'uploaded' | 'processing' | 'indexed' | 'failed'
export type AiMode = 'ask' | 'summarize' | 'solve' | 'calculator'

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

export interface AiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: AiCitation[]
  calculator: CalculatorSpec | null
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
  | { type: 'error'; message: string }
  | { type: 'done'; messageId: string }
