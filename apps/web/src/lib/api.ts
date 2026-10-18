import type {
  AiMessage,
  AiStreamEvent,
  AiThread,
  Calculator,
  CalculatorSpec,
  Course,
  CourseRole,
  DocJSON,
  FileAsset,
  Formula,
  Page,
  PageRevision,
  PageSummary,
  PageType,
  SearchHit,
} from '@nc/shared'

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
  tags: string[]
  content: DocJSON
  aiVisible: boolean
}

export interface BackupSummary {
  courses: number
  pages: number
  revisions: number
  calculators: number
  files: number
  createdAt: string
}

export interface BackupImportResult {
  courses: number
  pages: number
  calculators: number
  files: number
  warnings: string[]
}

export const api = {
  courses: {
    list: () => get<Course[]>('/courses'),
    create: (b: { name: string; color?: string; description?: string }) =>
      request<Course>('POST', '/courses', b),
    members: (id: string) =>
      get<{ userId: string; name: string; email: string; role: CourseRole }[]>(`/courses/${id}/members`),
    addMember: (id: string, b: { email: string; role: 'editor' | 'viewer' }) =>
      request('POST', `/courses/${id}/members`, b),
  },
  pages: {
    list: (courseId?: string) => get<PageSummary[]>(`/pages${qs({ courseId })}`),
    get: (id: string) => get<Page>(`/pages/${id}`),
    create: (b: PageInput & { courseId: string }) => request<Page>('POST', '/pages', b),
    update: (id: string, b: PageInput & { baseRevision: number; message?: string }) =>
      request<Page>('PUT', `/pages/${id}`, b),
    remove: (id: string) => request<void>('DELETE', `/pages/${id}`),
    revisions: (id: string) => get<PageRevision[]>(`/pages/${id}/revisions`),
  },
  formulas: (pinned?: boolean) => get<Formula[]>(`/formulas${qs({ pinned: pinned ? '1' : undefined })}`),
  files: {
    list: (o: { courseId?: string; pageId?: string } = {}) => get<FileAsset[]>(`/files${qs(o)}`),
    upload: (courseId: string, files: File[], pageId?: string) => {
      const fd = new FormData()
      fd.set('courseId', courseId)
      if (pageId) fd.set('pageId', pageId)
      for (const f of files) fd.append('files', f)
      return request<FileAsset[]>('POST', '/files', fd)
    },
    remove: (id: string) => request<void>('DELETE', `/files/${id}`),
    url: (id: string, inline = false) => `/api/files/${id}/download${inline ? '?inline=1' : ''}`,
  },
  calculators: {
    list: () => get<Calculator[]>('/calculators'),
    get: (id: string) => get<Calculator>(`/calculators/${id}`),
    create: (b: {
      spec: CalculatorSpec
      courseId?: string | null
      origin?: 'manual' | 'ai'
      sourcePageId?: string | null
    }) => request<Calculator>('POST', '/calculators', b),
    update: (id: string, b: { spec: CalculatorSpec; courseId: string | null }) =>
      request<Calculator>('PUT', `/calculators/${id}`, b),
    remove: (id: string) => request<void>('DELETE', `/calculators/${id}`),
    exportUrl: (id: string, format: 'json' | 'py' | 'html') =>
      `/api/calculators/${id}/export?format=${format}`,
  },
  backup: {
    exportUrl: () => '/api/backup/export',
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
    threads: () => get<AiThread[]>('/ai/threads'),
    thread: (id: string) => get<{ thread: AiThread; messages: AiMessage[] }>(`/ai/threads/${id}`),
    calculator: (context: string) => request<CalculatorSpec>('POST', '/ai/calculator', { context }),
  },
}

/** POST /api/ai/chat and yield server-sent events as they arrive. */
export async function* streamChat(
  body: { threadId?: string; mode: string; message: string; courseIds?: string[]; pageIds?: string[] },
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
