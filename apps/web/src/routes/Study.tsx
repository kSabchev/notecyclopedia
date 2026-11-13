import { ALL_WEEKDAYS, type Confidence, type ExamPlan, addDays } from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImportPlan, SharedWithYou } from '../components/PlanSharing'
import { Countdown, progressOf, todayLocal } from '../components/StudyParts'
import { Empty, ErrorNote, SectionHeader, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'

function useWeekdayName() {
  const { i18n } = useTranslation()
  // 2026-11-01 was a Sunday: weekday d is d days later.
  return (d: number) =>
    new Date(Date.UTC(2026, 10, 1 + d)).toLocaleDateString(i18n.language, {
      weekday: 'short',
      timeZone: 'UTC',
    })
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
