import type { AiUsage, DocJSON } from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, streamChat } from '../lib/api'
import { stashAppend } from '../lib/page-draft'
import { CloseIcon, SparkIcon } from './Icons'
import { Markdown } from './Markdown'
import { Tex } from './Tex'
import { ErrorNote, btn } from './ui'

import { type HelpKind, type HelpTarget, KINDS } from './ReadingHelp'

/** Where else a formula appears, and the calculators made from its page: no AI involved. */
function FormulaCard({
  pageId,
  nodeId,
  doc,
}: {
  pageId: string
  nodeId: string
  doc: DocJSON
}) {
  const { t } = useTranslation()
  const related = useQuery({
    queryKey: ['formula-related', pageId, nodeId],
    queryFn: () => api.formulaRelated(pageId, nodeId),
  })
  // Calculators embedded in this page (calculator and plot blocks), from the page itself.
  const embedded = ((doc.content ?? []) as { type: string; attrs?: Record<string, unknown> }[])
    .filter((n) => n.type === 'widget' && (n.attrs?.kind === 'calculator' || n.attrs?.kind === 'plot'))
    .map((n) => ({
      name: String((n.attrs?.spec as { name?: string } | undefined)?.name ?? ''),
      id: (n.attrs?.sourceCalculatorId as string | null) ?? null,
    }))
    .filter((c) => c.name)
  const calculators = [
    ...(related.data?.calculators ?? []),
    ...embedded.filter((c) => !related.data?.calculators.some((x) => x.id === c.id)),
  ]
  return (
    <section aria-label={t('help.formulaCard')} className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
          {t('help.elsewhere')}
        </h3>
        {related.data?.elsewhere.length === 0 && <p className="m-0 text-muted">{t('help.nowhereElse')}</p>}
        {related.data?.elsewhere.map((f) => (
          <Link
            key={`${f.pageId}-${f.nodeId}`}
            to="/pages/$pageId"
            params={{ pageId: f.pageId }}
            hash={f.nodeId ?? undefined}
            className="font-semibold"
          >
            {f.lectureNumber !== null ? `${t('page.lectureNumber', { n: f.lectureNumber })} · ` : ''}
            {f.pageTitle}
          </Link>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
          {t('help.calculators')}
        </h3>
        {related.isSuccess && calculators.length === 0 && (
          <p className="m-0 text-muted">{t('help.noCalculators')}</p>
        )}
        {calculators.map((c) =>
          c.id ? (
            <Link key={c.id} to="/calculators/$calcId" params={{ calcId: c.id }} className="font-semibold">
              {c.name}
            </Link>
          ) : (
            <span key={c.name}>{c.name}</span>
          ),
        )}
      </div>
    </section>
  )
}

/**
 * The side panel for a question about the page: for a formula, its card first (no AI) and the three questions;
 * then Claude's answer, with the page as its source. One Claude call per question, made only when asked.
 */
export default function HelpPanel({
  page,
  target,
  initialKind,
  requestId,
  canEdit,
  onClose,
}: {
  page: { id: string; title: string; content: DocJSON }
  target: HelpTarget
  /** The question to ask at once (from the selection toolbar); null to let the reader choose. */
  initialKind: HelpKind | null
  /** Changes with every new request, so each is asked exactly once. */
  requestId: number
  canEdit: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [kind, setKind] = useState<HelpKind | null>(initialKind)
  const [answer, setAnswer] = useState('')
  const [threadId, setThreadId] = useState<string | null>(null)
  const [usage, setUsage] = useState<AiUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const subject =
    target.type === 'text' ? target.text : `$$${target.latex}$$${target.label ? ` (${target.label})` : ''}`

  // Questions are asked from clicks, not from an effect that React may run twice in development: each Claude call
  // happens once. A new question cancels one still streaming.
  const ask = useCallback(
    async (next: HelpKind) => {
      abort.current?.abort()
      const controller = new AbortController()
      abort.current = controller
      setKind(next)
      setAnswer('')
      setUsage(null)
      setError(null)
      setStreaming(true)
      try {
        for await (const ev of streamChat(
          {
            mode: 'ask',
            message: t(`help.ask.${next}`, { title: page.title, subject }),
            pageIds: [page.id],
          },
          controller.signal,
        )) {
          if (ev.type === 'thread') setThreadId(ev.threadId)
          else if (ev.type === 'text') setAnswer((a) => a + ev.text)
          else if (ev.type === 'usage') setUsage(ev.usage)
          else if (ev.type === 'error') setError(ev.message)
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      } finally {
        if (abort.current === controller) setStreaming(false)
      }
    },
    [page.id, page.title, subject, t],
  )
  // The question chosen in the selection toolbar, asked once per request.
  const asked = useRef<number | null>(null)
  useEffect(() => {
    if (!initialKind || asked.current === requestId) return
    asked.current = requestId
    ask(initialKind)
  }, [initialKind, requestId, ask])

  const addToPage = () => {
    if (!kind) return
    const short =
      target.type === 'text' ? target.text.replace(/\s+/g, ' ').slice(0, 60) : (target.label ?? '')
    stashAppend(page.id, {
      title: short
        ? `${t(`help.kind.${kind}`)}: ${short}${short.length >= 60 ? '…' : ''}`
        : t(`help.kind.${kind}`),
      markdown: answer,
    })
    navigate({ to: '/pages/$pageId/edit', params: { pageId: page.id } })
  }

  return (
    <aside
      aria-label={t('help.panel')}
      className="fixed inset-y-0 right-0 z-50 flex w-[min(440px,100%)] flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-5 shadow-2xl"
    >
      <div className="flex items-center gap-2">
        <SparkIcon className="text-ai" />
        <h2 className="m-0 flex-1 text-base font-bold">{t('help.title')}</h2>
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={() => {
            abort.current?.abort()
            onClose()
          }}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent hover:bg-line-soft"
        >
          <CloseIcon />
        </button>
      </div>
      {target.type === 'formula' ? (
        <div className="overflow-x-auto rounded-[10px] bg-surface-2 px-4 py-3">
          <Tex latex={target.latex} display />
        </div>
      ) : (
        <blockquote className="m-0 border-l-4 border-line-strong pl-3 text-sm text-muted">
          {target.text.length > 300 ? `${target.text.slice(0, 300)}…` : target.text}
        </blockquote>
      )}
      {target.type === 'formula' && target.nodeId && (
        <FormulaCard pageId={page.id} nodeId={target.nodeId} doc={page.content} />
      )}
      <div role="group" aria-label={t('help.toolbar')} className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={k === kind}
            disabled={streaming}
            onClick={() => ask(k)}
            className={btn(k === kind ? 'ai' : 'secondary', 'sm')}
          >
            {t(`help.kind.${k}`)}
          </button>
        ))}
      </div>
      {kind && (
        <section aria-label={t('help.answer')} aria-busy={streaming} className="flex flex-col gap-3">
          {answer ? (
            <Markdown text={answer} />
          ) : (
            !error && <p className="m-0 text-muted">{t('common.loading')}</p>
          )}
          <ErrorNote error={error} />
          {!streaming && answer && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
              {canEdit && (
                <button type="button" className={btn('secondary', 'sm')} onClick={addToPage}>
                  {t('help.addToPage')}
                </button>
              )}
              {threadId && (
                <Link to="/ai" search={{ thread: threadId }} className={btn('secondary', 'sm')}>
                  {t('help.continue')}
                </Link>
              )}
              {usage?.costUsd != null && (
                <span className="text-xs text-muted">
                  ≈ ${usage.costUsd.toFixed(usage.costUsd < 0.01 ? 4 : 3)}
                </span>
              )}
            </div>
          )}
        </section>
      )}
    </aside>
  )
}
