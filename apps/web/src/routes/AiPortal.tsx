import type { AiCitation, AiMode, CalculatorSpec, WidgetAttrs } from '@nc/shared'
import { exportJSON } from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalculatorRunner } from '../components/CalculatorRunner'
import { SparkIcon } from '../components/Icons'
import { Markdown } from '../components/Markdown'
import { ErrorNote, btn } from '../components/ui'
import { OrbitView } from '../components/widgets/OrbitView'
import { api, streamChat } from '../lib/api'
import { MODES } from './Home'

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: AiCitation[]
  calculator: CalculatorSpec | null
  widgets: WidgetAttrs[]
}

export interface AiSearch {
  mode?: AiMode
  q?: string
  pageId?: string
  thread?: string
}

/** An orbit diagram the AI showed with its answer, with a link to explore it in the orbit viewer. */
function ShownOrbit({ widget }: { widget: Extract<WidgetAttrs, { kind: 'orbit' }> }) {
  const { t } = useTranslation()
  return (
    <section className="overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-surface-2 px-5 py-3">
        <span className="flex-1 font-semibold">{t('widget.orbit')}</span>
        <Link
          to="/orbit"
          search={{ body: widget.body, ...widget.elements }}
          className={btn('secondary', 'sm')}
        >
          {t('files.openInViewer')}
        </Link>
      </div>
      <OrbitView body={widget.body} elements={widget.elements} view={widget.view ?? undefined} />
    </section>
  )
}

function GeneratedCalculator({ spec }: { spec: CalculatorSpec }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: () => api.calculators.create({ spec, origin: 'ai' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calculators'] }),
  })
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportJSON(spec)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${spec.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section className="flex flex-col overflow-hidden rounded-[16px] border-2 border-ai bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-ai-soft px-5.5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-ai-text">
            {t('ai.generated')}
          </span>
          <h3 className="m-0 text-xl font-bold">{spec.name}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn('secondary', 'sm')} onClick={download}>
            Export .json
          </button>
          {save.data ? (
            <Link to="/calculators/$calcId" params={{ calcId: save.data.id }} className={btn('ai', 'sm')}>
              {t('calc.saved')} →
            </Link>
          ) : (
            <button
              type="button"
              className={btn('ai', 'sm')}
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {t('calc.saveToLibrary')}
            </button>
          )}
        </div>
      </div>
      <div className="p-5.5">
        <CalculatorRunner spec={spec} compact />
      </div>
      <ErrorNote error={save.error} />
    </section>
  )
}

export function AiPortal() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const search = useSearch({ from: '/app/ai' }) as AiSearch
  const [mode, setMode] = useState<AiMode>(search.mode ?? 'ask')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [threadId, setThreadId] = useState<string | undefined>(search.thread)
  const [courseIds, setCourseIds] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const autoSent = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)

  const status = useQuery({ queryKey: ['ai-status'], queryFn: api.ai.status })
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const threads = useQuery({ queryKey: ['ai-threads'], queryFn: api.ai.threads })

  // Load an existing session.
  useEffect(() => {
    if (!search.thread) return
    setThreadId(search.thread)
    api.ai.thread(search.thread).then(({ thread, messages: m }) => {
      setMode(thread.mode)
      setMessages(m.map((x) => ({ ...x })))
    })
  }, [search.thread])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever messages change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const send = async (text: string, pageIds?: string[]) => {
    if (!text.trim() || streaming) return
    setError(null)
    setInput('')
    const assistantId = crypto.randomUUID()
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: 'user', content: text, citations: [], calculator: null, widgets: [] },
      { id: assistantId, role: 'assistant', content: '', citations: [], calculator: null, widgets: [] },
    ])
    const patch = (fn: (m: Msg) => Msg) =>
      setMessages((all) => all.map((m) => (m.id === assistantId ? fn(m) : m)))
    setStreaming(true)
    abort.current = new AbortController()
    try {
      for await (const ev of streamChat(
        { threadId, mode, message: text, courseIds: courseIds.length ? courseIds : undefined, pageIds },
        abort.current.signal,
      )) {
        if (ev.type === 'thread') setThreadId(ev.threadId)
        else if (ev.type === 'citations') patch((m) => ({ ...m, citations: ev.citations }))
        else if (ev.type === 'text') patch((m) => ({ ...m, content: m.content + ev.text }))
        else if (ev.type === 'calculator') patch((m) => ({ ...m, calculator: ev.spec }))
        else if (ev.type === 'widget') patch((m) => ({ ...m, widgets: [...m.widgets, ev.widget] }))
        else if (ev.type === 'error') setError(ev.message)
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      setStreaming(false)
      qc.invalidateQueries({ queryKey: ['ai-threads'] })
    }
  }

  // Coming from Home or a page with a prepared question (runs once, guarded by autoSent).
  useEffect(() => {
    if (autoSent.current || !search.q || !status.data?.configured) return
    autoSent.current = true
    send(search.q, search.pageId ? [search.pageId] : undefined)
    navigate({ to: '/ai', search: {}, replace: true })
  })

  const last = [...messages].reverse().find((m) => m.role === 'assistant')
  const newSession = () => {
    abort.current?.abort()
    setMessages([])
    setThreadId(undefined)
    navigate({ to: '/ai', search: {} })
  }

  return (
    <div className="flex flex-wrap items-start gap-8 px-6 pb-10 pt-7 md:px-10">
      <div className="flex min-w-0 flex-[3_1_560px] flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="m-0 text-[30px] font-extrabold tracking-[-0.02em]">{t('ai.title')}</h1>
          <div
            role="tablist"
            aria-label="Mode"
            className="flex flex-wrap gap-1 rounded-[12px] bg-line-soft p-1"
          >
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={m === mode}
                onClick={() => setMode(m)}
                className={`min-h-10 cursor-pointer rounded-[9px] px-3.5 text-sm font-semibold ${m === mode ? 'bg-surface text-ai-text shadow-sm' : 'text-muted'}`}
              >
                {t(`modes.${m}`)}
              </button>
            ))}
          </div>
        </div>

        {status.data && !status.data.configured && <ErrorNote error={t('ai.notConfigured')} />}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div
              key={m.id}
              className="max-w-[620px] self-end whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-inverse px-5 py-4 text-base text-inverse-ink"
            >
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="flex flex-col gap-4">
              <article className="flex flex-col gap-4 rounded-[16px] border border-line bg-surface px-7 py-6">
                <div className="flex items-center gap-2.5 font-bold">
                  <SparkIcon className="text-ai" />
                  {t(`modes.${mode}`)}
                </div>
                {m.content ? (
                  <Markdown text={m.content} />
                ) : (
                  <span className="text-muted">{t('common.loading')}</span>
                )}
                {m.citations.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t border-line-soft pt-3">
                    {m.citations.map((c, i) =>
                      c.sourceType === 'page' ? (
                        <Link
                          key={c.sourceId}
                          to="/pages/$pageId"
                          params={{ pageId: c.sourceId }}
                          className="rounded-md bg-accent-soft px-2 py-0.5 text-[13px] font-semibold no-underline"
                        >
                          [{i + 1}] {c.title}
                        </Link>
                      ) : (
                        <a
                          key={c.sourceId}
                          href={api.files.url(c.sourceId, true)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md bg-line-soft px-2 py-0.5 text-[13px] font-semibold text-ink no-underline"
                        >
                          [{i + 1}] {c.title}
                        </a>
                      ),
                    )}
                  </div>
                )}
              </article>
              {m.widgets?.map((w) =>
                w.kind === 'orbit' ? <ShownOrbit key={JSON.stringify(w.elements)} widget={w} /> : null,
              )}
              {m.calculator && <GeneratedCalculator spec={m.calculator} />}
            </div>
          ),
        )}
        <ErrorNote error={error} />
        <div ref={endRef} />

        <form
          className="flex flex-col gap-2.5 rounded-[16px] border border-line-strong bg-surface p-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <label htmlFor="composer" className="sr-only">
            Message
          </label>
          <textarea
            id="composer"
            rows={3}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(input)
            }}
            placeholder={t(`ai.placeholder.${mode}`)}
            className="resize-y border-0 bg-transparent px-2 py-1.5 text-base outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">{t('ai.disclaimer')}</span>
            <span className="flex-1" />
            {streaming ? (
              <button type="button" className={btn('secondary')} onClick={() => abort.current?.abort()}>
                {t('ai.stop')}
              </button>
            ) : (
              <button
                type="submit"
                className={btn('ai')}
                disabled={!status.data?.configured || !input.trim()}
              >
                {t(`modes.${mode}`)}
              </button>
            )}
          </div>
        </form>
      </div>

      <aside className="flex min-w-0 flex-[1_1_280px] flex-col gap-5">
        <section
          aria-labelledby="h-src"
          className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface p-5"
        >
          <h2 id="h-src" className="m-0 mb-2 text-base font-bold">
            {t('ai.sources')}
          </h2>
          <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="h-[18px] w-[18px] accent-ai"
              checked={courseIds.length === 0}
              onChange={() => setCourseIds([])}
            />
            {t('ai.allCourses')}
          </label>
          {courses.data?.map((c) => (
            <label key={c.id} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                className="h-[18px] w-[18px] accent-ai"
                checked={courseIds.includes(c.id)}
                onChange={(e) =>
                  setCourseIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))
                }
              />
              {c.name}
            </label>
          ))}
        </section>

        {last && last.citations.length > 0 && (
          <section
            aria-labelledby="h-used"
            className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-5"
          >
            <h2 id="h-used" className="m-0 text-base font-bold">
              {t('ai.used')}
            </h2>
            {last.citations.map((c) => (
              <span key={c.sourceId} className="rounded-[10px] bg-bg px-3 py-2.5 text-sm font-semibold">
                {c.title}
              </span>
            ))}
          </section>
        )}

        <section
          aria-labelledby="h-recent"
          className="flex flex-col gap-1 rounded-[14px] bg-inverse p-5 text-inverse-ink"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 id="h-recent" className="m-0 text-base font-bold">
              {t('ai.recent')}
            </h2>
            <button
              type="button"
              className="min-h-10 cursor-pointer text-sm font-semibold text-ai-on-dark"
              onClick={newSession}
            >
              + {t('ai.newSession')}
            </button>
          </div>
          {threads.data?.map((th) => (
            <Link
              key={th.id}
              to="/ai"
              search={{ thread: th.id }}
              className={`flex min-h-11 items-center truncate rounded-[9px] px-3 text-sm text-inverse-ink no-underline hover:bg-inverse-2 hover:text-inverse-ink ${th.id === threadId ? 'bg-inverse-2 font-semibold' : ''}`}
            >
              {th.title}
            </Link>
          ))}
        </section>
      </aside>
    </div>
  )
}
