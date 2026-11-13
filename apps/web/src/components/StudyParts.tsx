import { type ExamPlan, type ExamPlanItem, daysBetween } from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { todayLocal } from '../lib/format'
import { useLectureExtras } from '../lib/lectures'
import { lectureAnchor, taskLecture } from '../lib/links'
import { btn, inputCls } from './ui'

/** Pieces both the exam prep list (Study.tsx) and a revision plan (StudyPlan.tsx) show. */

/**
 * A task's lecture and calculators as links, and **Link** to set them: a lecture of the plan's course and any of
 * your calculators (those tagged with the course first).
 */
export function TaskLinks({
  item,
  courseId,
  lectures,
  pageLecture,
  onChange,
}: {
  item: ExamPlanItem
  courseId: string
  /** The course's lecture numbers (from its pages and originals). */
  lectures: number[]
  pageLecture: (pageId: string) => number | null | undefined
  onChange: (change: Partial<ExamPlanItem>) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const extras = useLectureExtras()
  const calculators = useQuery({
    queryKey: ['calculators'],
    queryFn: api.calculators.list,
    select: (rows) => rows.filter((c) => !c.archivedAt),
  })
  const lecture = taskLecture(item, pageLecture)
  const linked = (item.calculatorIds ?? [])
    .map((id) => calculators.data?.find((c) => c.id === id))
    .filter((c) => c !== undefined)
  const choices = [...(calculators.data ?? [])].sort(
    (a, b) =>
      Number(b.courseId === courseId) - Number(a.courseId === courseId) || a.name.localeCompare(b.name),
  )
  const chip = 'rounded-md bg-line-soft px-2 py-0.5 text-xs font-semibold text-ink no-underline'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {lecture !== null &&
          (extras.original(courseId, lecture) ? (
            <Link to="/lectures" hash={lectureAnchor(courseId, lecture)} className={chip}>
              {t('page.lectureNumber', { n: lecture })}
            </Link>
          ) : (
            <span className={chip}>{t('page.lectureNumber', { n: lecture })}</span>
          ))}
        {linked.map((c) => (
          <Link key={c.id} to="/calculators/$calcId" params={{ calcId: c.id }} className={chip}>
            {c.name}
          </Link>
        ))}
        <button
          type="button"
          aria-expanded={open}
          aria-label={t('connect.linkTask', { task: item.focus })}
          className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-accent"
          onClick={() => setOpen((value) => !value)}
        >
          {t('connect.link')}
        </button>
      </div>
      {open && (
        <fieldset className="m-0 flex flex-col gap-2 rounded-[10px] border border-line bg-surface-2 p-3">
          <legend className="sr-only">{t('connect.linkTask', { task: item.focus })}</legend>
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">
            {t('connect.taskLecture')}
            <select
              aria-label={t('connect.taskLecture')}
              className={`${inputCls} min-h-8 py-0.5 text-sm`}
              value={item.lectureNumber ?? ''}
              onChange={(e) => onChange({ lectureNumber: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">
                {item.pageId && pageLecture(item.pageId) != null
                  ? t('page.lectureNumber', { n: pageLecture(item.pageId) })
                  : t('connect.noLecture')}
              </option>
              {lectures.map((n) => (
                <option key={n} value={n}>
                  {t('page.lectureNumber', { n })}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">{t('connect.taskCalculators')}</span>
            {choices.length === 0 && <span className="text-xs text-muted">{t('connect.noCalculators')}</span>}
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
              {choices.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(item.calculatorIds ?? []).includes(c.id)}
                    onChange={(e) => {
                      const ids = new Set(item.calculatorIds ?? [])
                      if (e.target.checked) ids.add(c.id)
                      else ids.delete(c.id)
                      onChange({ calculatorIds: [...ids].slice(0, 10) })
                    }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
          <button
            type="button"
            className={`${btn('secondary', 'sm')} self-start`}
            onClick={() => setOpen(false)}
          >
            {t('connect.done')}
          </button>
        </fieldset>
      )}
    </div>
  )
}

export function Countdown({ examDate }: { examDate: string }) {
  const { t } = useTranslation()
  const left = daysBetween(todayLocal(), examDate)
  if (left < 0) return <>{t('study.examPassed')}</>
  if (left === 0) return <>{t('study.examToday')}</>
  return <>{t('study.daysLeft', { count: left })}</>
}

export const progressOf = (plan: ExamPlan) => {
  const items = plan.days.flatMap((d) => d.items)
  return { done: items.filter((i) => i.done).length, total: items.length }
}
