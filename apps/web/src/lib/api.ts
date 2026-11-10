import type {
  AiAttachment,
  AiMessage,
  AiStreamEvent,
  AiThread,
  AiUsage,
  Calculator,
  CalculatorReview,
  CalculatorSpec,
  Confidence,
  Course,
  CourseConstant,
  CourseRole,
  DailyExpansionKind,
  DailyQuestion,
  DocJSON,
  ExamPlan,
  FileAsset,
  Formula,
  Locale,
  Page,
  PageReference,
  PageRevision,
  PageSummary,
  PageType,
  PlanShare,
  QuickCheck,
  SearchHit,
  TodaysRevision,
  WhereWasI,
} from '@nc/shared'
import i18n from '../i18n'

/** The interface language, sent with AI requests as the fallback language for short notes. */
/** A link you added to the Useful links page. */
export interface UserLink {
  id: string
  title: string
  url: string
  note: string | null
}

const uiLocale = (): Locale => (i18n.language?.startsWith('bg') ? 'bg' : 'en')

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'include',
    headers: body && !isForm ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText)
  return data as T
}

const get = <T>(url: string) => request<T>('GET', url)
const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export interface PageInput {
  title: string
  type: PageType
  lectureNumber: number | null
  tags: string[]
  content: DocJSON
  aiVisible: boolean
}

export interface BackupSummary {
  courses: number
  pages: number
  revisions: number
  calculators: number
  constants: number
  files: number
  createdAt: string
}

export interface BackupImportResult {
  courses: number
  pages: number
  calculators: number
  constants: number
  files: number
  warnings: string[]
}

export interface ArticleDraft {
  title: string
  tags: string[]
  content: DocJSON
}

export interface PageReview {
  page: Page
  review: {
    findings: string[]
    content: DocJSON
  }
}

export interface ClaudeApiCall {
  id: string
  userEmail: string | null
  operation: string
  model: string
  request: Record<string, unknown>
  status: 'succeeded' | 'failed'
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  estimatedCostUsd: string | null
  error: string | null
  createdAt: string
}

export interface ClaudeApiCallsPage {
  calls: ClaudeApiCall[]
  hasMore: boolean
}

export const api = {
  courses: {
    list: () => get<Course[]>('/courses'),
    reorder: (courseIds: string[]) => request<void>('PUT', '/courses/order', { courseIds }),
    create: (b: { name: string; color?: string; description?: string }) =>
      request<Course>('POST', '/courses', b),
    members: (id: string) =>
      get<{ userId: string; name: string; email: string; role: CourseRole }[]>(`/courses/${id}/members`),
    constants: (id: string) => get<CourseConstant[]>(`/courses/${id}/constants`),
    createConstant: (id: string, body: Omit<CourseConstant, 'id' | 'courseId' | 'createdAt' | 'updatedAt'>) =>
      request<CourseConstant>('POST', `/courses/${id}/constants`, body),
    updateConstant: (
      id: string,
      constantId: string,
      body: Omit<CourseConstant, 'id' | 'courseId' | 'createdAt' | 'updatedAt'>,
    ) => request<CourseConstant>('PUT', `/courses/${id}/constants/${constantId}`, body),
    removeConstant: (id: string, constantId: string) =>
      request<void>('DELETE', `/courses/${id}/constants/${constantId}`),
    addMember: (id: string, b: { email: string; role: 'editor' | 'viewer' }) =>
      request('POST', `/courses/${id}/members`, b),
  },
  pages: {
    /** Remembers that you opened the page, for "Where was I". */
    visit: (id: string) => request<void>('POST', `/pages/${id}/visit`),
    list: (courseId?: string) =>
      get<PageSummary[]>(`/pages${qs({ courseId, limit: courseId ? '500' : undefined })}`),
    reorder: (courseId: string, pageIds: string[]) =>
      request<void>('PUT', '/pages/order', { courseId, pageIds }),
    get: (id: string) => get<Page>(`/pages/${id}`),
    create: (b: PageInput & { courseId: string; sourceFileId?: string }) =>
      request<Page>('POST', '/pages', b),
    move: (id: string, courseId: string) => request<Page>('POST', `/pages/${id}/move`, { courseId }),
    update: (id: string, b: PageInput & { baseRevision: number; message?: string }) =>
      request<Page>('PUT', `/pages/${id}`, b),
    remove: (id: string) => request<void>('DELETE', `/pages/${id}`),
    revisions: (id: string) => get<PageRevision[]>(`/pages/${id}/revisions`),
    /** Pages that link to this page or to a term on it. */
    references: (id: string) => get<PageReference[]>(`/pages/${id}/references`),
    revision: (id: string, rev: number) =>
      get<{ revision: number; title: string; content: DocJSON }>(`/pages/${id}/revisions/${rev}`),
    restore: (id: string, rev: number, b: { baseRevision: number; message?: string }) =>
      request<Page>('POST', `/pages/${id}/revisions/${rev}/restore`, b),
  },
  /** For a formula card: the same formula elsewhere, and calculators made from its page. */
  /** Pin a formula to your home page, or unpin it (pins are personal). */
  pinFormula: (pageId: string, nodeId: string, pinned: boolean) =>
    pinned
      ? request<void>('POST', '/formulas/pins', { pageId, nodeId })
      : request<void>('DELETE', `/formulas/pins${qs({ pageId, nodeId })}`),
  formulaRelated: (pageId: string, nodeId: string) =>
    get<{
      elsewhere: {
        pageId: string
        nodeId: string | null
        pageTitle: string
        pageType: string
        lectureNumber: number | null
      }[]
      calculators: { id: string; name: string }[]
    }>(`/formulas/related${qs({ pageId, nodeId })}`),
  formulas: (pinned?: boolean) => get<Formula[]>(`/formulas${qs({ pinned: pinned ? '1' : undefined })}`),
  files: {
    /** The latest 200 uploads, or with `originals`, every lecture's original. */
    list: (
      o: {
        courseId?: string
        pageId?: string
        originals?: '1'
        /** Part of the file name. */
        q?: string
        offset?: string
        limit?: string
      } = {},
    ) => get<FileAsset[]>(`/files${qs(o)}`),
    /** With `lectureNumber`, the (single) upload becomes the original of that lecture. */
    upload: (courseId: string, files: File[], pageId?: string, lectureNumber?: number) => {
      const fd = new FormData()
      fd.set('courseId', courseId)
      if (pageId) fd.set('pageId', pageId)
      if (lectureNumber) fd.set('lectureNumber', String(lectureNumber))
      for (const f of files) fd.append('files', f)
      return request<FileAsset[]>('POST', '/files', fd)
    },
    remove: (id: string) => request<void>('DELETE', `/files/${id}`),
    /** Mark an upload as the original of a lecture, or unmark it (null). */
    /** With another `courseId`, the file moves there and becomes the original of that course's lecture. */
    setLecture: (id: string, lectureNumber: number | null, courseId?: string) =>
      request<FileAsset>('PATCH', `/files/${id}/lecture`, { lectureNumber, courseId }),
    articleDraft: (id: string) => request<ArticleDraft>('POST', `/files/${id}/article-draft`),
    url: (id: string, inline = false) => `/api/files/${id}/download${inline ? '?inline=1' : ''}`,
  },
  lectures: {
    /** Move a lecture (its original, and with `withParts` its pages and calculators) to another course or number. */
    move: (b: {
      courseId: string
      lectureNumber: number
      toCourseId: string
      toLectureNumber: number
      withParts: boolean
    }) => request<{ pages: number; calculators: number }>('POST', '/lectures/move', b),
  },
  calculators: {
    list: () => get<Calculator[]>('/calculators'),
    get: (id: string) => get<Calculator>(`/calculators/${id}`),
    create: (b: {
      spec: CalculatorSpec
      courseId?: string | null
      origin?: 'manual' | 'ai'
      sourcePageId?: string | null
      lectureNumber?: number | null
    }) => request<Calculator>('POST', '/calculators', b),
    update: (
      id: string,
      b: { spec: CalculatorSpec; courseId: string | null; lectureNumber: number | null },
    ) => request<Calculator>('PUT', `/calculators/${id}`, b),
    remove: (id: string) => request<void>('DELETE', `/calculators/${id}`),
    /** Hide it from the list, the picker and the tutor (pages that embed it keep working), or restore it. */
    archive: (id: string, archived: boolean) =>
      request<Calculator>('PATCH', `/calculators/${id}/archive`, { archived }),
    /** A copy to rework, leaving the original for the pages that embed it. */
    duplicate: (id: string) => request<Calculator>('POST', `/calculators/${id}/duplicate`, {}),
    exportUrl: (id: string, format: 'json' | 'py' | 'html' | 'xlsx') =>
      `/api/calculators/${id}/export?format=${format}`,
  },
  backup: {
    exportUrl: () => '/api/backup/export',
    /** When your last backup download finished (null: never). */
    status: () => get<{ lastBackupAt: string | null }>('/backup/status'),
    preview: (file: File) => {
      const body = new FormData()
      body.set('archive', file)
      return request<BackupSummary>('POST', '/backup/preview', body)
    },
    import: (file: File) => {
      const body = new FormData()
      body.set('archive', file)
      return request<BackupImportResult>('POST', '/backup/import', body)
    },
  },
  search: (q: string) => get<SearchHit[]>(`/search${qs({ q })}`),
  ai: {
    status: () => get<{ configured: boolean }>('/ai/status'),
    reviewPage: (id: string) => request<PageReview>('POST', `/ai/pages/${id}/review`),
    /** Questions to check an answer was understood: one call the first time, kept afterwards. */
    quickCheck: (messageId: string) =>
      request<QuickCheck>('POST', `/ai/messages/${messageId}/quick-check`, { locale: uiLocale() }),
    threads: () => get<AiThread[]>('/ai/threads'),
    thread: (id: string) => get<{ thread: AiThread; messages: AiMessage[] }>(`/ai/threads/${id}`),
    /** Calculators from a description or a solved problem; with `messageId` they are stored with that answer. */
    /** A topic hub draft for a course, linking to where the topic is covered; nothing is saved. */
    topicHub: (courseId: string, topic: string) =>
      request<{ content: DocJSON; targets: number; usage: AiUsage | null }>('POST', '/ai/topic-hub', {
        courseId,
        topic,
        locale: uiLocale(),
      }),
    /** Claude's check of a saved calculator, with a proposed correction; nothing is saved. */
    reviewCalculator: (id: string) =>
      request<CalculatorReview>('POST', `/ai/calculators/${id}/review`, { locale: uiLocale() }),
    /** Proposed changes for "solve for r instead" and the like; nothing is saved. */
    reworkCalculator: (id: string, instructions: string) =>
      request<CalculatorReview>('POST', `/ai/calculators/${id}/rework`, { locale: uiLocale(), instructions }),
    calculator: (context: string, messageId?: string) =>
      request<{ calculators: CalculatorSpec[]; failed: string[] }>('POST', '/ai/calculator', {
        context,
        messageId,
      }),
  },
  links: {
    list: () => get<UserLink[]>('/links'),
    add: (link: { title: string; url: string; note?: string }) => request<UserLink>('POST', '/links', link),
    remove: (id: string) => request<void>('DELETE', `/links/${id}`),
  },
  study: {
    where: () => get<WhereWasI>('/study/where'),
    plans: () => get<ExamPlan[]>('/study/plans'),
    plan: (id: string) => get<ExamPlan>(`/study/plans/${id}`),
    /** Proposes a revision plan in one Claude call and saves it. */
    createPlan: (input: {
      courseId: string
      examDate: string
      minutesPerDay: number
      weekdays: number[]
      pages?: { id: string; confidence: Confidence | null }[]
      note?: string
    }) => request<ExamPlan>('POST', '/study/plans', { ...input, locale: uiLocale() }),
    savePlan: (plan: Pick<ExamPlan, 'id' | 'title' | 'examDate' | 'days'>) =>
      request<ExamPlan>('PUT', `/study/plans/${plan.id}`, {
        title: plan.title,
        examDate: plan.examDate,
        days: plan.days,
      }),
    deletePlan: (id: string) => request<void>('DELETE', `/study/plans/${id}`),
    /** Pause (kept, out of today's revision) or resume a plan. */
    setPlanActive: (id: string, active: boolean) =>
      request<ExamPlan>('PATCH', `/study/plans/${id}`, { active }),
    exportUrl: (id: string) => `/api/study/plans/${id}/export`,
    importPlan: (courseId: string, plan: unknown, keepProgress: boolean) =>
      request<{ plan: ExamPlan; linked: number; unlinked: number }>('POST', '/study/plans/import', {
        courseId,
        plan,
        keepProgress,
      }),
    /** Send a copy to another member of the plan's course. */
    sharePlan: (id: string, userId: string) =>
      request<{ id: string }>('POST', `/study/plans/${id}/share`, { userId }),
    shares: () => get<PlanShare[]>('/study/shares'),
    acceptShare: (id: string) => request<ExamPlan>('POST', `/study/shares/${id}/accept`),
    declineShare: (id: string) => request<void>('DELETE', `/study/shares/${id}`),
    setTaskDone: (planId: string, itemId: string, done: boolean) =>
      request<ExamPlan>('PATCH', `/study/plans/${planId}/items/${itemId}`, { done }),
    /** Today's tasks of the plans whose exam is ahead. */
    today: () => get<{ today: string; plans: TodaysRevision[] }>('/study/today'),
  },
  daily: {
    today: () => get<{ day: string; question: DailyQuestion | null }>('/daily/today'),
    /** Makes today's question (one Claude call), or returns it if it was already made. */
    generate: (courseId?: string) =>
      request<DailyQuestion>('POST', '/daily/today', { courseId, locale: uiLocale() }),
    /** Another question, any time: avoids topics and questions already asked. */
    ask: (courseId?: string) => request<DailyQuestion>('POST', '/daily', { courseId, locale: uiLocale() }),
    /** The user's questions, newest first, 30 at a time. */
    list: (params: { courseId?: string; q?: string; offset: number }) =>
      get<DailyQuestion[]>(
        `/daily${qs({ courseId: params.courseId, q: params.q || undefined, offset: String(params.offset) })}`,
      ),
    expand: (id: string, kind: DailyExpansionKind) =>
      request<DailyQuestion>('POST', `/daily/${id}/expand`, { kind, locale: uiLocale() }),
    save: (id: string, labels: { question: string; answer: string; story: string; advanced: string }) =>
      request<{ pageId: string }>('POST', `/daily/${id}/save`, { labels }),
  },
  admin: {
    access: () => get<{ isAdmin: boolean }>('/admin/access'),
    claudeCalls: (offset: number) =>
      get<ClaudeApiCallsPage>(`/admin/claude-calls${qs({ limit: '50', offset: String(offset) })}`),
  },
}

/** POST /api/ai/chat and yield server-sent events as they arrive. */
export async function* streamChat(
  body: {
    threadId?: string
    mode: string
    message: string
    attachments?: AiAttachment[]
    courseIds?: string[]
    pageIds?: string[]
  },
  signal?: AbortSignal,
): AsyncGenerator<AiStreamEvent> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value
    let i = buf.indexOf('\n\n')
    while (i >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 2)
      if (line.startsWith('data:')) yield JSON.parse(line.slice(5)) as AiStreamEvent
      i = buf.indexOf('\n\n')
    }
  }
}
