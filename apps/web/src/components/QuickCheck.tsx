import type { QuickCheck as Check } from '@nc/shared'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { formatCost } from '../lib/format'
import { Markdown } from './Markdown'
import { ErrorNote, btn } from './ui'

/**
 * "Check my understanding" under an explanation: two or three questions, made only when asked (one AI call) and
 * kept with the answer. Answers stay hidden until you try.
 */
export function QuickCheck({ messageId, initial }: { messageId: string; initial?: Check | null }) {
  const { t } = useTranslation()
  const [check, setCheck] = useState<Check | null>(initial ?? null)
  const [shown, setShown] = useState<number[]>([])
  const make = useMutation({ mutationFn: () => api.ai.quickCheck(messageId), onSuccess: setCheck })
  if (!check)
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={btn('secondary', 'sm')}
          disabled={make.isPending}
          onClick={() => make.mutate()}
        >
          {make.isPending ? t('quickCheck.asking') : t('quickCheck.ask')}
        </button>
        <ErrorNote error={make.error} />
      </div>
    )
  return (
    <section
      aria-label={t('quickCheck.title')}
      className="flex w-full flex-col gap-3 rounded-[12px] bg-surface-2 p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-[15px] font-bold">{t('quickCheck.title')}</h3>
        {check.usage?.costUsd != null && (
          <span className="text-xs text-muted">
            {t('quickCheck.cost', { cost: formatCost(check.usage.costUsd) })}
          </span>
        )}
      </div>
      <ol className="m-0 flex list-decimal flex-col gap-3 pl-5">
        {check.questions.map((q, i) => (
          <li key={q.question} className="flex flex-col gap-2">
            <Markdown text={q.question} />
            {shown.includes(i) && (
              <div className="rounded-[10px] border border-line bg-surface px-3 py-2">
                <Markdown text={q.answer} />
              </div>
            )}
            <button
              type="button"
              className="cursor-pointer self-start border-0 bg-transparent p-0 text-sm font-semibold text-accent"
              aria-expanded={shown.includes(i)}
              onClick={() => setShown((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]))}
            >
              {shown.includes(i) ? t('quickCheck.hide') : t('quickCheck.show')}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
