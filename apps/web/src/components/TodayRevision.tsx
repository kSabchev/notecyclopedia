import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { CalendarIcon } from './Icons'
import { ErrorNote } from './ui'

/**
 * Today's tasks from your revision plans, on the home page, ticked off in place. Hidden when no plan has a task
 * today or anything to catch up.
 */
export function TodayRevision() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const today = useQuery({ queryKey: ['study', 'today'], queryFn: api.study.today })
  /** Ticks shown at once, while they are saved. */
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<unknown>(null)
  const plans = today.data?.plans ?? []
  if (!plans.length) return null

  const toggle = (planId: string, itemId: string, done: boolean) => {
    setTicked((x) => ({ ...x, [itemId]: done }))
    setError(null)
    api.study
      .setTaskDone(planId, itemId, done)
      .then((plan) => {
        qc.setQueryData(['study', 'plan', planId], plan)
        qc.invalidateQueries({ queryKey: ['study', 'plans'] })
      })
      .catch((e) => {
        setTicked((x) => ({ ...x, [itemId]: !done }))
        setError(e)
      })
  }

  return (
    <section
      aria-labelledby="h-today-revision"
      className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5"
    >
      <h2 id="h-today-revision" className="m-0 flex items-center gap-2 text-lg font-bold">
        <CalendarIcon className="text-accent" />
        {t('study.todayTitle')}
      </h2>
      {plans.map((plan) => (
        <div key={plan.planId} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold">{plan.title}</span>
            <Link to="/study/$planId" params={{ planId: plan.planId }} className="text-sm font-semibold">
              {t('study.openPlan')} →
            </Link>
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {plan.items.map((item) => {
              const done = ticked[item.id] ?? item.done
              return (
                <li key={item.id} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={item.focus}
                    className="h-[18px] w-[18px] accent-accent"
                    checked={done}
                    onChange={(e) => toggle(plan.planId, item.id, e.target.checked)}
                  />
                  <span className={`flex-1 ${done ? 'text-muted line-through' : ''}`}>{item.focus}</span>
                  {item.pageId && (
                    <Link to="/pages/$pageId" params={{ pageId: item.pageId }} className="text-sm">
                      {item.pageTitle}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
          {plan.overdue > 0 && (
            <Link to="/study/$planId" params={{ planId: plan.planId }} className="text-sm">
              {t('study.overdue', { count: plan.overdue })}
            </Link>
          )}
        </div>
      ))}
      <ErrorNote error={error} />
    </section>
  )
}
