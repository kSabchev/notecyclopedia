import type { AiCitation, AiUsage, CalculatorSpec, WidgetAttrs } from '@nc/shared'
import { fileSlug } from '@nc/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type ReactNode, Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { formatCost } from '../../lib/format'
import { stashAppend } from '../../lib/page-draft'
import { ErrorNote, btn } from '../ui'

/** What an answer can show besides its text: the widgets Claude used, calculators it made, saving it, its cost. */
// Calculators (math.js) and orbit diagrams load only when an answer shows one.
const CalculatorRunner = lazy(() =>
  import('../CalculatorRunner').then((m) => ({ default: m.CalculatorRunner })),
)
const OrbitView = lazy(() => import('../widgets/OrbitView').then((m) => ({ default: m.OrbitView })))
const loading = <div className="h-24" />

/** A widget shown with an answer: a title bar with an action, and the widget, loaded when shown. */
function WidgetCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-surface-2 px-5 py-3">
        <span className="flex-1 font-semibold">{title}</span>
        {action}
      </div>
      <Suspense fallback={loading}>{children}</Suspense>
    </section>
  )
}

/** An orbit diagram the AI showed with its answer, with a link to explore it in the orbit viewer. */
export function ShownOrbit({ widget }: { widget: Extract<WidgetAttrs, { kind: 'orbit' }> }) {
  const { t } = useTranslation()
  return (
    <WidgetCard
      title={t('widget.orbit')}
      action={
        <Link
          to="/orbit"
          search={{ body: widget.body, ...widget.elements }}
          className={btn('secondary', 'sm')}
        >
          {t('files.openInViewer')}
        </Link>
      }
    >
      <OrbitView body={widget.body} elements={widget.elements} view={widget.view ?? undefined} />
    </WidgetCard>
  )
}

/** A saved calculator the AI ran for its answer, with the values it used and the step-by-step working. */
export function ShownCalculator({ widget }: { widget: Extract<WidgetAttrs, { kind: 'calculator' }> }) {
  const { t } = useTranslation()
  return (
    <WidgetCard
      title={t('ai.calculatorRun', { name: widget.spec.name })}
      action={
        widget.sourceCalculatorId && (
          <Link
            to="/calculators/$calcId"
            params={{ calcId: widget.sourceCalculatorId }}
            className={btn('secondary', 'sm')}
          >
            {t('ai.openCalculator')}
          </Link>
        )
      }
    >
      <CalculatorRunner spec={widget.spec} />
    </WidgetCard>
  )
}

/**
 * "Save to page" for an answer: pick one of the pages it cites; the answer opens in that page's editor as an unsaved
 * addition at the end, to review and save, so an explanation is paid for once.
 */
export function SaveToPage({
  question,
  answer,
  pages,
}: { question: string; answer: string; pages: AiCitation[] }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  if (!pages.length) return null
  const title = question.replace(/\s+/g, ' ').trim()
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t('ai.saveToPage')}</span>
      <select
        className="h-9 cursor-pointer rounded-[10px] border border-line-strong bg-surface px-2 text-sm font-semibold"
        value=""
        onChange={(e) => {
          const pageId = e.target.value
          if (!pageId) return
          stashAppend(pageId, {
            title: title.length > 80 ? `${title.slice(0, 80)}…` : title,
            markdown: answer,
          })
          navigate({ to: '/pages/$pageId/edit', params: { pageId } })
        }}
      >
        <option value="">{t('ai.saveToPage')}</option>
        {pages.map((c) => (
          <option key={c.sourceId} value={c.sourceId}>
            {c.title}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Tokens and estimated cost of an answer. */
export function UsageLine({ usage }: { usage: AiUsage }) {
  const { t, i18n } = useTranslation()
  const n = (x: number) => x.toLocaleString(i18n.language)
  const input = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const cost = usage.costUsd === null ? null : formatCost(usage.costUsd)
  return (
    <p className="m-0 text-xs text-muted">
      {t('ai.usage', { input: n(input), cached: n(usage.cacheReadTokens), output: n(usage.outputTokens) })}
      {cost && ` · ≈ ${cost}`} · {usage.models.join(', ')}
    </p>
  )
}

export function GeneratedCalculator({ spec }: { spec: CalculatorSpec }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: () => api.calculators.create({ spec, origin: 'ai' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calculators'] }),
  })
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileSlug(spec.name.toLowerCase(), 'calculator')}.json`
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
        <Suspense fallback={loading}>
          <CalculatorRunner spec={spec} compact />
        </Suspense>
      </div>
      <ErrorNote error={save.error} />
    </section>
  )
}
