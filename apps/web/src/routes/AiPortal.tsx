import type {
  AiAttachment,
  AiCitation,
  AiMode,
  AiUsage,
  CalculatorSpec,
  QuickCheck as QuickCheckData,
  WidgetAttrs,
} from '@nc/shared'
import { AI_MODES } from '@nc/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SparkIcon } from '../components/Icons'
import { Markdown } from '../components/Markdown'
import { QuickCheck } from '../components/QuickCheck'
import {
  GeneratedCalculator,
  SaveToPage,
  ShownCalculator,
  ShownOrbit,
  UsageLine,
} from '../components/ai/AnswerExtras'
import { Composer } from '../components/ai/Composer'
import { Citations, UserMessage } from '../components/ai/Messages'
import { PortalSidebar } from '../components/ai/PortalSidebar'
import { ErrorNote, btn } from '../components/ui'
import { api, streamChat } from '../lib/api'

interface Msg {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: AiCitation[]
  calculators: CalculatorSpec[]
  widgets: WidgetAttrs[]
  attachments: AiAttachment[]
  usage: AiUsage | null
  /** Set once the answer is stored (loaded, or its stream finished), so a quick check can be kept with it. */
  stored?: boolean
  quickCheck?: QuickCheckData | null
}

/** Modes that answer step by step, where a hint or the full solution is one click away. */
const GUIDED: AiMode[] = ['tutor', 'check']

export interface AiSearch {
  mode?: AiMode
  q?: string
  pageId?: string
  thread?: string
  /** Text to start the message with, without sending it (e.g. your own question about the daily question). */
  prefill?: string
}

export function AiPortal() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const search = useSearch({ from: '/app/ai' }) as AiSearch
  const [mode, setMode] = useState<AiMode>(search.mode ?? 'ask')
  const [input, setInput] = useState(search.prefill ?? '')
  const [messages, setMessages] = useState<Msg[]>([])
  const [threadId, setThreadId] = useState<string | undefined>(search.thread)
  const [courseIds, setCourseIds] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const [photos, setPhotos] = useState<AiAttachment[]>([])
  const [building, setBuilding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const autoSent = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)

  const status = useQuery({ queryKey: ['ai-status'], queryFn: api.ai.status })

  // Load an existing session.
  useEffect(() => {
    if (!search.thread) return
    setThreadId(search.thread)
    api.ai.thread(search.thread).then(({ thread, messages: m }) => {
      setMode(thread.mode)
      setMessages(m.map((x) => ({ ...x, stored: true })))
    })
  }, [search.thread])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever messages change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const send = async (text: string, opts: { pageIds?: string[]; attachments?: AiAttachment[] } = {}) => {
    const attachments = opts.attachments ?? []
    if ((!text.trim() && !attachments.length) || streaming) return
    setError(null)
    setInput('')
    setPhotos([])
    const assistantId = crypto.randomUUID()
    const blank = { citations: [], calculators: [], widgets: [], attachments: [], usage: null }
    setMessages((m) => [
      ...m,
      { ...blank, id: crypto.randomUUID(), role: 'user', content: text, attachments },
      { ...blank, id: assistantId, role: 'assistant', content: '' },
    ])
    const patch = (fn: (m: Msg) => Msg) =>
      setMessages((all) => all.map((m) => (m.id === assistantId ? fn(m) : m)))
    setStreaming(true)
    abort.current = new AbortController()
    try {
      for await (const ev of streamChat(
        {
          threadId,
          mode,
          message: text,
          attachments,
          courseIds: courseIds.length ? courseIds : undefined,
          pageIds: opts.pageIds,
        },
        abort.current.signal,
      )) {
        if (ev.type === 'thread') setThreadId(ev.threadId)
        else if (ev.type === 'citations') patch((m) => ({ ...m, citations: ev.citations }))
        else if (ev.type === 'text') patch((m) => ({ ...m, content: m.content + ev.text }))
        else if (ev.type === 'calculator') patch((m) => ({ ...m, calculators: [...m.calculators, ev.spec] }))
        else if (ev.type === 'widget') patch((m) => ({ ...m, widgets: [...m.widgets, ev.widget] }))
        else if (ev.type === 'usage') patch((m) => ({ ...m, usage: ev.usage }))
        // The stored answer's id, so calculators made from it later are stored with it.
        else if (ev.type === 'done' && ev.messageId) patch((m) => ({ ...m, id: ev.messageId, stored: true }))
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
    send(search.q, { pageIds: search.pageId ? [search.pageId] : undefined })
    navigate({ to: '/ai', search: {}, replace: true })
  })

  const last = [...messages].reverse().find((m) => m.role === 'assistant')

  // A calculator from a worked answer, made only when asked (one Claude call).
  const buildCalculator = async (index: number) => {
    const answer = messages[index]
    if (!answer) return
    const question = messages[index - 1]?.content ?? ''
    setBuilding(answer.id)
    setError(null)
    try {
      const made = await api.ai.calculator(
        `Problem:\n${question.slice(0, 6000)}\n\nSolution:\n${answer.content.slice(0, 13000)}`,
        answer.id,
      )
      setMessages((all) =>
        all.map((m) =>
          m.id === answer.id ? { ...m, calculators: [...m.calculators, ...made.calculators] } : m,
        ),
      )
      if (made.failed.length) setError(`${t('ai.someCalculatorsFailed')} ${made.failed.join('; ')}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBuilding(null)
    }
  }
  // "Make a calculator" for a worked solution: a Solve answer, or a full solution asked of the tutor.
  // ("Build calculator" makes one by itself; a hint is not worth turning into a calculator.)
  const canBuild = (m: Msg, index: number) =>
    m.role === 'assistant' &&
    !!m.content &&
    !m.calculators.length &&
    (mode === 'solve' || messages[index - 1]?.content === t('ai.quick.solution')) &&
    !(streaming && m === last)

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
            {AI_MODES.map((m) => (
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

        {messages.map((m, index) =>
          m.role === 'user' ? (
            <UserMessage key={m.id} content={m.content} attachments={m.attachments} />
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
                <Citations citations={m.citations} />
                {(m.usage || canBuild(m, index) || (m.stored && m.content)) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
                    {m.usage ? <UsageLine usage={m.usage} /> : <span />}
                    {!(streaming && m === last) && m.content && (
                      <SaveToPage
                        question={messages[index - 1]?.content ?? ''}
                        answer={m.content}
                        pages={m.citations.filter((c) => c.sourceType === 'page')}
                      />
                    )}
                    {m.stored && m.content && !(streaming && m === last) && (
                      <QuickCheck key={m.id} messageId={m.id} initial={m.quickCheck} />
                    )}
                    {canBuild(m, index) && (
                      <button
                        type="button"
                        className={btn('secondary', 'sm')}
                        disabled={building !== null}
                        onClick={() => buildCalculator(index)}
                      >
                        {building === m.id ? t('common.loading') : t('ai.makeCalculator')}
                      </button>
                    )}
                  </div>
                )}
              </article>
              {m.widgets?.map((w, i) =>
                w.kind === 'orbit' ? (
                  <ShownOrbit key={JSON.stringify(w.elements)} widget={w} />
                ) : w.kind === 'calculator' ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: widgets of an answer are only appended
                  <ShownCalculator key={i} widget={w} />
                ) : null,
              )}
              {m.calculators?.map((spec, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: calculators of an answer are only appended
                <GeneratedCalculator key={i} spec={spec} />
              ))}
            </div>
          ),
        )}
        {!streaming && last?.content && GUIDED.includes(mode) && (
          <div className="flex flex-wrap gap-2">
            {mode === 'tutor' && (
              <button
                type="button"
                className={btn('secondary', 'sm')}
                onClick={() => send(t('ai.quick.hint'))}
              >
                {t('ai.quick.hintLabel')}
              </button>
            )}
            <button
              type="button"
              className={btn('secondary', 'sm')}
              onClick={() => send(t('ai.quick.solution'))}
            >
              {t('ai.quick.solutionLabel')}
            </button>
          </div>
        )}
        <ErrorNote error={error} />
        <div ref={endRef} />

        <Composer
          mode={mode}
          input={input}
          onInput={setInput}
          photos={photos}
          onPhotos={setPhotos}
          onSend={() => send(input, { attachments: photos })}
          onStop={() => abort.current?.abort()}
          streaming={streaming}
          configured={!!status.data?.configured}
          onError={setError}
        />
      </div>

      <PortalSidebar
        courseIds={courseIds}
        onCourseIds={setCourseIds}
        used={last?.citations ?? []}
        threadId={threadId}
        onNewSession={newSession}
      />
    </div>
  )
}
