import {
  type ExamPlan,
  type ExamPlanItem,
  catchUp,
  fitBeforeExam,
  overdueTasks,
  studyDates,
  tasksFromExamOn,
} from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon, PenIcon } from '../components/Icons'
import { PlanActions } from '../components/PlanSharing'
import { Countdown, TaskLinks, progressOf, todayLocal, useDayLabel } from '../components/StudyParts'
import { ErrorNote, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { formatCost } from '../lib/format'
import { useLectureExtras } from '../lib/lectures'

/** A revision plan, edited in place: every change is saved straight away. */
export function StudyPlan() {
  const { t } = useTranslation()
  const { planId } = useParams({ from: '/app/study/$planId' })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const dayLabel = useDayLabel()
  const plan = useQuery({ queryKey: ['study', 'plan', planId], queryFn: () => api.study.plan(planId) })
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const coursePages = useQuery({
    queryKey: ['pages', 'course', plan.data?.courseId],
    queryFn: () => api.pages.list(plan.data?.courseId),
    enabled: !!plan.data,
  })
  const save = useMutation({
    mutationFn: api.study.savePlan,
    onSuccess: (saved) => {
      // The edits shown stay the ones on screen; a slower earlier save must not undo a later change.
      qc.setQueryData(['study', 'plan', planId], saved)
      qc.invalidateQueries({ queryKey: ['study', 'plans'] })
    },
  })
  const remove = useMutation({
    mutationFn: () => api.study.deletePlan(planId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study', 'plans'] })
      navigate({ to: '/study' })
    },
  })
  const [adding, setAdding] = useState<Record<string, { focus: string; pageId: string }>>({})
  const extras = useLectureExtras()
  /** The plan as edited on this screen; edits show at once (a ticked box stays ticked) and are saved behind. */
  const [edited, setEdited] = useState<ExamPlan | null>(null)
  const [noDaysLeft, setNoDaysLeft] = useState(false)

  if (plan.error) return <ErrorNote error={plan.error} />
  const p = edited?.id === planId ? edited : plan.data
  if (!p) return <p className="px-12 pt-10 text-muted">{t('common.loading')}</p>
  const today = todayLocal()
  const progress = progressOf(p)
  const course = courses.data?.find((c) => c.id === p.courseId)
  // Shown at once (a ticked box stays ticked), then saved.
  const update = (changes: Partial<Pick<ExamPlan, 'title' | 'examDate' | 'days'>>) => {
    const next = { ...p, ...changes }
    setEdited(next)
    save.mutate({ id: p.id, title: next.title, examDate: next.examDate, days: next.days })
  }
  const setItem = (date: string, id: string, change: (item: ExamPlanItem) => ExamPlanItem | null) =>
    update({
      days: p.days.map((d) =>
        d.date === date
          ? {
              ...d,
              items: d.items.flatMap((i) => (i.id === id ? [change(i)].filter((x) => x !== null) : [i])),
            }
          : d,
      ),
    })
  // Any study day up to the exam, not only days that already have tasks; a day left empty disappears.
  const moveItem = (from: string, id: string, to: string) => {
    const item = p.days.find((d) => d.date === from)?.items.find((i) => i.id === id)
    if (!item || from === to) return
    const days = p.days.map((d) =>
      d.date === from ? { ...d, items: d.items.filter((i) => i.id !== id) } : d,
    )
    if (!days.some((d) => d.date === to)) days.push({ date: to, items: [] })
    update({
      days: days
        .map((d) => (d.date === to ? { ...d, items: [...d.items, item] } : d))
        .filter((d) => d.items.length)
        .sort((a, b) => a.date.localeCompare(b.date)),
    })
  }
  const moveTargets = [
    ...new Set([...p.days.map((d) => d.date), ...studyDates(today, p.examDate, p.studyWeekdays)]),
  ].sort()
  const pageLecture = (id: string) => coursePages.data?.find((cp) => cp.id === id)?.lectureNumber
  // The lectures a task can point at: those with pages or an original.
  const lectureNumbers = [
    ...new Set([
      ...(coursePages.data ?? []).map((cp) => cp.lectureNumber),
      ...extras.originalsOf(p.courseId).map((f) => f.lectureNumber),
    ]),
  ]
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)
  const overdue = overdueTasks(p.days, today).length
  const afterExam = tasksFromExamOn(p.days, p.examDate).length
  const reschedule = (days: ExamPlan['days'] | null) => {
    if (days) update({ days })
    else setNoDaysLeft(true)
  }
  const addItem = (date: string) => {
    const draft = adding[date]
    if (!draft?.focus.trim()) return
    const page = coursePages.data?.find((cp) => cp.id === draft.pageId)
    update({
      days: p.days.map((d) =>
        d.date === date
          ? {
              ...d,
              items: [
                ...d.items,
                {
                  id: crypto.randomUUID(),
                  pageId: page?.id ?? null,
                  pageTitle: page?.title ?? null,
                  focus: draft.focus.trim(),
                  done: false,
                },
              ],
            }
          : d,
      ),
    })
    setAdding((a) => ({ ...a, [date]: { focus: '', pageId: '' } }))
  }

  return (
    <div className="flex flex-col gap-6 px-6 pb-18 pt-10 md:px-12">
      <Link to="/study" className="text-sm font-semibold">
        ← {t('study.back')}
      </Link>
      <header className="flex flex-col gap-3">
        <label className="group flex items-center gap-3" title={t('study.rename')}>
          <input
            aria-label={t('study.planTitle')}
            defaultValue={p.title}
            key={p.title}
            onBlur={(e) => {
              const title = e.target.value.trim()
              if (title && title !== p.title) update({ title })
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="m-0 min-w-[4ch] max-w-full rounded-lg border border-transparent [field-sizing:content] bg-transparent px-1 text-[32px] font-extrabold tracking-[-0.02em] text-ink hover:border-line focus:border-accent"
          />
          <PenIcon className="shrink-0 text-muted group-hover:text-ink" aria-hidden />
        </label>
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {course && (
            <span className="flex items-center gap-2 font-semibold text-ink">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: course.color }} />
              {course.name}
            </span>
          )}
          <label className="flex items-center gap-2">
            {t('study.examDate')}
            <input
              type="date"
              className={`${inputCls} min-h-9 py-1`}
              value={p.examDate}
              onChange={(e) => e.target.value && update({ examDate: e.target.value })}
            />
          </label>
          <span>
            <Countdown examDate={p.examDate} />
          </span>
          <span>{t('study.progress', progress)}</span>
          <span aria-live="polite">
            {save.isPending ? t('study.saving') : save.isSuccess ? t('study.saved') : ''}
          </span>
          {p.usage?.costUsd != null && (
            <span>{t('study.madeFor', { cost: formatCost(p.usage.costUsd) })}</span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            className={btn('danger', 'sm')}
            onClick={() => window.confirm(t('study.confirmDelete')) && remove.mutate()}
          >
            {t('study.delete')}
          </button>
        </div>
        <ErrorNote error={save.error ?? remove.error} />
        <PlanActions plan={p} onChange={(saved) => setEdited({ ...p, active: saved.active })} />
        {(overdue > 0 || afterExam > 0) && (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-[12px] border border-note-line bg-note px-4 py-3 text-sm"
          >
            {overdue > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex-1">
                  {t('study.catchUpNote', { count: overdue })}{' '}
                  <span className="text-muted">{t('study.catchUpHint')}</span>
                </span>
                <button
                  type="button"
                  className={btn('secondary', 'sm')}
                  onClick={() => reschedule(catchUp(p.days, today, p.examDate, p.studyWeekdays))}
                >
                  {t('study.catchUp')}
                </button>
              </div>
            )}
            {afterExam > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex-1">{t('study.afterExam', { count: afterExam })}</span>
                <button
                  type="button"
                  className={btn('secondary', 'sm')}
                  onClick={() => reschedule(fitBeforeExam(p.days, today, p.examDate, p.studyWeekdays))}
                >
                  {t('study.fitBeforeExam')}
                </button>
              </div>
            )}
            {noDaysLeft && <ErrorNote error={t('study.noDaysLeft')} />}
          </div>
        )}
      </header>

      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,560px),1fr))] items-start gap-4 p-0">
        {p.days.map((d) => (
          <li
            key={d.date}
            aria-label={dayLabel(d.date)}
            className={`flex flex-col gap-3 rounded-[14px] border bg-surface p-5 ${d.date === today ? 'border-2 border-accent' : 'border-line'} ${d.date < today ? 'opacity-70' : ''}`}
          >
            <h2 className="m-0 flex items-center gap-2 text-base font-bold">
              {dayLabel(d.date)}
              {d.date === today && (
                <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                  {t('study.today')}
                </span>
              )}
            </h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {d.items.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={item.focus}
                    className="h-[18px] w-[18px] accent-accent"
                    checked={item.done}
                    onChange={(e) => setItem(d.date, item.id, (i) => ({ ...i, done: e.target.checked }))}
                  />
                  <div className="flex min-w-48 flex-1 flex-col">
                    <input
                      aria-label={t('study.task')}
                      defaultValue={item.focus}
                      key={item.focus}
                      onBlur={(e) => {
                        const focus = e.target.value.trim()
                        if (focus && focus !== item.focus) setItem(d.date, item.id, (i) => ({ ...i, focus }))
                      }}
                      className={`border-0 bg-transparent p-0 font-medium text-ink ${item.done ? 'line-through text-muted' : ''}`}
                    />
                    {item.pageId ? (
                      <Link to="/pages/$pageId" params={{ pageId: item.pageId }} className="text-sm">
                        {item.pageTitle}
                      </Link>
                    ) : (
                      item.pageTitle && (
                        <span className="text-sm text-muted">
                          {item.pageTitle} ({t('study.deletedPage')})
                        </span>
                      )
                    )}
                    <TaskLinks
                      item={item}
                      courseId={p.courseId}
                      lectures={lectureNumbers}
                      pageLecture={pageLecture}
                      onChange={(change) => setItem(d.date, item.id, (i) => ({ ...i, ...change }))}
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    {t('study.moveTo')}
                    <select
                      className={`${inputCls} min-h-9 py-1 text-sm`}
                      value={d.date}
                      onChange={(e) => moveItem(d.date, item.id, e.target.value)}
                    >
                      {moveTargets.map((date) => (
                        <option key={date} value={date}>
                          {dayLabel(date)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    aria-label={`${t('study.remove')}: ${item.focus}`}
                    onClick={() => setItem(d.date, item.id, () => null)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-line-soft"
                  >
                    <CloseIcon size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                addItem(d.date)
              }}
            >
              <input
                aria-label={`${t('study.addItem')} — ${dayLabel(d.date)}`}
                placeholder={t('study.addPlaceholder')}
                className={`${inputCls} min-w-48 flex-1 text-sm`}
                value={adding[d.date]?.focus ?? ''}
                onChange={(e) =>
                  setAdding((a) => ({
                    ...a,
                    [d.date]: { focus: e.target.value, pageId: a[d.date]?.pageId ?? '' },
                  }))
                }
              />
              <select
                aria-label={t('study.page')}
                className={`${inputCls} text-sm`}
                value={adding[d.date]?.pageId ?? ''}
                onChange={(e) =>
                  setAdding((a) => ({
                    ...a,
                    [d.date]: { focus: a[d.date]?.focus ?? '', pageId: e.target.value },
                  }))
                }
              >
                <option value="">{t('study.noPage')}</option>
                {coursePages.data?.map((cp) => (
                  <option key={cp.id} value={cp.id}>
                    {cp.title}
                  </option>
                ))}
              </select>
              <button type="submit" className={btn('secondary', 'sm')}>
                {t('study.add')}
              </button>
            </form>
          </li>
        ))}
      </ol>
    </div>
  )
}
