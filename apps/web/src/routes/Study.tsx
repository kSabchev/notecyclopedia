import {
  ALL_WEEKDAYS,
  type Confidence,
  type ExamPlan,
  type ExamPlanItem,
  addDays,
  catchUp,
  daysBetween,
  fitBeforeExam,
  overdueTasks,
  studyDates,
  tasksFromExamOn,
} from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon, PenIcon } from '../components/Icons'
import { ImportPlan, PlanActions, SharedWithYou } from '../components/PlanSharing'
import { Empty, ErrorNote, SectionHeader, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { formatCost } from '../lib/format'

/** Today in the browser's time zone, as YYYY-MM-DD. */
const todayLocal = () => new Date().toLocaleDateString('en-CA')

function useDayLabel() {
  const { i18n } = useTranslation()
  return (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    })
}

function useWeekdayName() {
  const { i18n } = useTranslation()
  // 2026-11-01 was a Sunday: weekday d is d days later.
  return (d: number) =>
    new Date(Date.UTC(2026, 10, 1 + d)).toLocaleDateString(i18n.language, {
      weekday: 'short',
      timeZone: 'UTC',
    })
}

function Countdown({ examDate }: { examDate: string }) {
  const { t } = useTranslation()
  const left = daysBetween(todayLocal(), examDate)
  if (left < 0) return <>{t('study.examPassed')}</>
  if (left === 0) return <>{t('study.examToday')}</>
  return <>{t('study.daysLeft', { count: left })}</>
}

const progressOf = (plan: ExamPlan) => {
  const items = plan.days.flatMap((d) => d.items)
  return { done: items.filter((i) => i.done).length, total: items.length }
}

/** Exam prep: your revision plans, and a form to have one proposed for a course. */
export function Study() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const plans = useQuery({ queryKey: ['study', 'plans'], queryFn: api.study.plans })
  const [courseId, setCourseId] = useState('')
  const [examDate, setExamDate] = useState(() => addDays(todayLocal(), 14))
  const [minutes, setMinutes] = useState(60)
  const [note, setNote] = useState('')
  const [weekdays, setWeekdays] = useState<number[]>(ALL_WEEKDAYS)
  /** Pages left out of the exam, and how well each page is known; the rest are in scope, "not said". */
  const [excluded, setExcluded] = useState<string[]>([])
  const [confidence, setConfidence] = useState<Record<string, Confidence>>({})
  const chosen = courseId || courses.data?.[0]?.id || ''
  const coursePages = useQuery({
    queryKey: ['pages', 'course', chosen],
    queryFn: () => api.pages.list(chosen),
    enabled: !!chosen,
  })
  const inScope = coursePages.data?.filter((cp) => !excluded.includes(cp.id)) ?? []
  const weekdayName = useWeekdayName()
  const create = useMutation({
    mutationFn: () =>
      api.study.createPlan({
        courseId: chosen,
        examDate,
        minutesPerDay: minutes,
        weekdays,
        pages: inScope.map((cp) => ({ id: cp.id, confidence: confidence[cp.id] ?? null })),
        note: note.trim() || undefined,
      }),
    onSuccess: (plan) => {
      qc.setQueryData(['study', 'plan', plan.id], plan)
      qc.invalidateQueries({ queryKey: ['study', 'plans'] })
      navigate({ to: '/study/$planId', params: { planId: plan.id } })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (chosen && inScope.length && weekdays.length && !create.isPending) create.mutate()
  }
  const courseOf = (id: string) => courses.data?.find((c) => c.id === id)
  const today = todayLocal()
  // A plan for this course whose exam is still ahead: proposing another is usually a mistake (and a second call).
  const existing = plans.data?.find((p) => p.active && p.courseId === chosen && p.examDate >= today)
  const upcoming = plans.data?.filter((p) => p.active && p.examDate >= today) ?? []
  const paused = plans.data?.filter((p) => !p.active && p.examDate >= today) ?? []
  const past = plans.data?.filter((p) => p.examDate < today).reverse() ?? []
  const planList = (list: ExamPlan[]) => (
    <div className="flex flex-col rounded-[12px] border border-line bg-surface">
      {list.map((p, i) => {
        const c = courseOf(p.courseId)
        const progress = progressOf(p)
        return (
          <Link
            key={p.id}
            to="/study/$planId"
            params={{ planId: p.id }}
            className={`flex flex-wrap items-center gap-3 px-5 py-3.5 text-ink no-underline hover:bg-surface-2 ${i ? 'border-t border-line' : ''}`}
          >
            <span className="h-2 w-2 rounded-[2px]" style={{ background: c?.color }} />
            <span className="min-w-0 flex-1 font-semibold">{p.title}</span>
            <span className="text-sm text-muted">
              {c?.name} · {p.examDate} · <Countdown examDate={p.examDate} />
            </span>
            {!p.active && (
              <span className="rounded-md bg-line-soft px-2 py-0.5 text-xs font-semibold text-muted">
                {t('study.pausedTag')}
              </span>
            )}
            <span className="text-sm text-muted">{t('study.progress', progress)}</span>
          </Link>
        )
      })}
    </div>
  )

  return (
    <div className="flex flex-col gap-8 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-[36px] font-extrabold tracking-[-0.02em]">{t('study.title')}</h1>
        <p className="m-0 max-w-[640px] text-muted">{t('study.intro')}</p>
      </header>

      <form
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-5"
        aria-label={t('study.create')}
      >
        <div className="flex flex-wrap gap-4">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-[13px] font-semibold text-muted">
            {t('study.course')}
            <select
              className={inputCls}
              value={chosen}
              onChange={(e) => {
                setCourseId(e.target.value)
                setExcluded([])
                setConfidence({})
              }}
            >
              {courses.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
            {t('study.examDate')}
            <input
              type="date"
              className={inputCls}
              value={examDate}
              min={addDays(todayLocal(), 1)}
              max={addDays(todayLocal(), 90)}
              onChange={(e) => setExamDate(e.target.value)}
              required
            />
          </label>
          <label className="flex w-36 flex-col gap-1 text-[13px] font-semibold text-muted">
            {t('study.minutes')}
            <input
              type="number"
              className={inputCls}
              min={15}
              max={600}
              step={15}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value) || 60)}
            />
          </label>
        </div>
        <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-[13px] font-semibold text-muted">{t('study.weekdays')}</legend>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <label
              key={d}
              className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${weekdays.includes(d) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted'}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={weekdays.includes(d)}
                onChange={(e) =>
                  setWeekdays((w) => (e.target.checked ? [...w, d].sort() : w.filter((x) => x !== d)))
                }
              />
              {weekdayName(d)}
            </label>
          ))}
        </fieldset>
        {!!coursePages.data?.length && (
          <details className="rounded-[10px] border border-line">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
              {t('study.scope')} ·{' '}
              <span className="font-normal text-muted">
                {t('study.scopeSummary', { chosen: inScope.length, total: coursePages.data.length })}
              </span>
            </summary>
            <ul className="m-0 flex list-none flex-col border-t border-line p-0">
              {coursePages.data.map((cp) => (
                <li
                  key={cp.id}
                  className="flex flex-wrap items-center gap-3 border-b border-line-soft px-4 py-2 last:border-0"
                >
                  <label className="flex min-w-48 flex-1 items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      className="h-[18px] w-[18px] accent-accent"
                      aria-label={`${t('study.inScope')}: ${cp.title}`}
                      checked={!excluded.includes(cp.id)}
                      onChange={(e) =>
                        setExcluded((x) =>
                          e.target.checked ? x.filter((id) => id !== cp.id) : [...x, cp.id],
                        )
                      }
                    />
                    <span className="font-medium">{cp.title}</span>
                    <span className="text-xs text-muted">{t(`editor.types.${cp.type}`)}</span>
                  </label>
                  <select
                    aria-label={t('study.confidenceOf', { title: cp.title })}
                    className={`${inputCls} min-h-9 py-1 text-sm`}
                    disabled={excluded.includes(cp.id)}
                    value={confidence[cp.id] ?? ''}
                    onChange={(e) =>
                      setConfidence((c) => {
                        const next = { ...c }
                        if (e.target.value) next[cp.id] = e.target.value as Confidence
                        else delete next[cp.id]
                        return next
                      })
                    }
                  >
                    <option value="">{t('study.confidence.unset')}</option>
                    <option value="know">{t('study.confidence.know')}</option>
                    <option value="shaky">{t('study.confidence.shaky')}</option>
                    <option value="new">{t('study.confidence.new')}</option>
                  </select>
                </li>
              ))}
            </ul>
          </details>
        )}
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
          {t('study.note')}
          <input
            className={inputCls}
            value={note}
            maxLength={500}
            placeholder={t('study.notePlaceholder')}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {existing && (
          <p role="status" className="m-0 rounded-[10px] border border-note-line bg-note px-4 py-3 text-sm">
            {t('study.existing', { title: existing.title, date: existing.examDate })}{' '}
            <Link to="/study/$planId" params={{ planId: existing.id }} className="font-semibold">
              {t('study.openExisting')}
            </Link>
          </p>
        )}
        <ErrorNote error={create.error} />
        <button
          type="submit"
          className={`${btn(existing ? 'secondary' : 'ai')} self-start`}
          disabled={!chosen || !inScope.length || !weekdays.length || create.isPending}
        >
          {create.isPending ? t('study.creating') : existing ? t('study.another') : t('study.create')}
        </button>
      </form>

      <SharedWithYou />

      <section aria-labelledby="h-plans" className="flex flex-col gap-3">
        <SectionHeader id="h-plans" title={t('study.plans')} />
        {plans.data?.length === 0 && <Empty>{t('study.none')}</Empty>}
        {upcoming.length > 0 && planList(upcoming)}
        {paused.length > 0 && (
          <details>
            <summary className="cursor-pointer py-2 text-sm font-semibold text-muted">
              {t('study.pausedGroup', { count: paused.length })}
            </summary>
            {planList(paused)}
          </details>
        )}
        {past.length > 0 && (
          <details>
            <summary className="cursor-pointer py-2 text-sm font-semibold text-muted">
              {t('study.past', { count: past.length })}
            </summary>
            {planList(past)}
          </details>
        )}
        <ImportPlan courses={courses.data ?? []} />
      </section>
    </div>
  )
}

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
