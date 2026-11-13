import { type CalculatorIssue, type CalculatorReview, type CalculatorSpec, diffSpecs } from '@nc/shared'
import { useTranslation } from 'react-i18next'
import { btn } from './ui'

/** The checks shown on a calculator: the app's own (no AI) and Claude's review with its proposed changes. */

/** One automatic-check finding as a sentence. */
function IssueText({ issue }: { issue: CalculatorIssue }) {
  const { t } = useTranslation()
  if (issue.type === 'evaluation') return <>{t('calc.check.evaluation', { message: issue.message })}</>
  if (issue.type === 'unused') return <>{t('calc.check.unused', { label: issue.label, key: issue.key })}</>
  if (issue.type === 'constant-input')
    return <>{t('calc.check.constantInput', { label: issue.label, key: issue.key })}</>
  if (issue.actual === null) return <>{t('calc.check.unitsMixed', { label: issue.label })}</>
  if (issue.actual === '1')
    return <>{t('calc.check.unitsPlain', { label: issue.label, expected: issue.expected })}</>
  if (issue.expected === null)
    return <>{t('calc.check.unitsNone', { label: issue.label, actual: issue.actual })}</>
  return <>{t('calc.check.units', { label: issue.label, expected: issue.expected, actual: issue.actual })}</>
}

/** Problems found without AI, shown while viewing and live while editing. */
export function AutomaticChecks({
  issues,
  onMakeConstant,
}: {
  issues: CalculatorIssue[]
  /** Fix a constant given as an input (opens the editor with the change, to review and save). */
  onMakeConstant?: (key: string) => void
}) {
  const { t } = useTranslation()
  if (!issues.length) return null
  return (
    <section
      aria-labelledby="h-checks"
      className="flex flex-col gap-2 border-t border-note-line bg-note px-6 py-4 text-sm"
    >
      <h3 id="h-checks" className="m-0 text-sm font-bold">
        {t('calc.check.title')}
      </h3>
      <ul className="m-0 flex flex-col gap-1 pl-5">
        {issues.map((issue) => (
          <li key={`${issue.type}-${'key' in issue ? issue.key : ''}`}>
            <IssueText issue={issue} />
            {issue.type === 'constant-input' && onMakeConstant && (
              <button
                type="button"
                className={`${btn('secondary', 'sm')} ml-2`}
                onClick={() => onMakeConstant(issue.key)}
              >
                {t('calc.makeConstant')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="m-0 text-xs text-muted">{t('calc.check.hint')}</p>
    </section>
  )
}

/** Changes to these fields are prose; the rest (formulas, units, values) are shown as code. */
const PROSE_FIELDS = new Set(['name', 'description', 'theory', 'label', 'explanation'])

const SEVERITY_CLS = {
  error: 'bg-danger-soft text-danger',
  warning: 'border border-note-line bg-note text-ink',
  note: 'bg-line-soft text-muted',
} as const

/** Claude's findings and the exact changes it proposes, to take into the editor or dismiss. */
export function ReviewPanel({
  review,
  current,
  onApply,
  onDismiss,
  title,
}: {
  review: CalculatorReview
  current: CalculatorSpec
  onApply: (spec: CalculatorSpec) => void
  onDismiss: () => void
  /** "AI check" or "AI rework". */
  title?: string
}) {
  const { t } = useTranslation()
  const changes = review.revised ? diffSpecs(current, review.revised) : []
  const cost = review.usage?.costUsd
  return (
    <section
      aria-labelledby="h-review"
      className="flex flex-col gap-4 border-t-2 border-ai bg-ai-soft px-6 py-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="h-review" className="m-0 text-base font-bold">
          {title ?? t('calc.review.title')}
        </h3>
        {cost != null && <span className="text-xs text-muted">≈ ${cost.toFixed(cost < 0.01 ? 4 : 3)}</span>}
      </div>
      {review.findings.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {review.findings.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: findings of one review never change
            <li key={i} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${SEVERITY_CLS[f.severity]}`}>
                {t(`calc.review.severity.${f.severity}`)}
              </span>
              {f.key && <code className="text-[13px]">{f.key}</code>}
              <span className="min-w-0 flex-1">{f.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm">{t('calc.review.none')}</p>
      )}
      {review.revised ? (
        <div className="flex flex-col gap-2">
          <h4 className="m-0 text-sm font-bold">{t('calc.review.changes')}</h4>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {changes.map((c) => (
              <li
                key={`${c.area}-${c.key}-${c.field}`}
                className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="text-xs font-semibold text-muted">
                  {t(`calc.review.area.${c.area}`)}
                  {c.area !== 'calculator' && <code className="ml-1.5">{c.key}</code>} ·{' '}
                  {t(`calc.review.field.${c.field}`, { defaultValue: c.field })}
                </span>
                {c.before !== null && (
                  <span
                    className={`whitespace-pre-wrap text-danger line-through [overflow-wrap:anywhere] ${PROSE_FIELDS.has(c.field) ? '' : 'font-mono text-[13px]'}`}
                  >
                    {c.before}
                  </span>
                )}
                {c.after !== null && (
                  <span
                    className={`whitespace-pre-wrap [overflow-wrap:anywhere] ${PROSE_FIELDS.has(c.field) ? '' : 'font-mono text-[13px]'}`}
                  >
                    {c.after}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {review.revisedChecks.length > 0 && (
            <div className="text-sm">
              {t('calc.review.stillIssues')}
              <ul className="m-0 pl-5">
                {review.revisedChecks.map((issue) => (
                  <li key={`${issue.type}-${'key' in issue ? issue.key : ''}`}>
                    <IssueText issue={issue} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="m-0 text-sm text-muted">{t('calc.review.noChanges')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {review.revised && changes.length > 0 && (
          <button
            type="button"
            className={btn('ai', 'sm')}
            onClick={() => review.revised && onApply(review.revised)}
          >
            {t('calc.review.apply')}
          </button>
        )}
        <button type="button" className={btn('secondary', 'sm')} onClick={onDismiss}>
          {t('calc.review.dismiss')}
        </button>
      </div>
    </section>
  )
}
