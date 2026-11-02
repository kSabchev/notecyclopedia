import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { DailyQuestionView } from './DailyQuestionView'
import { ErrorNote, btn, inputCls } from './ui'

const COURSE_KEY = 'nc.daily.course'

/** The course chosen for questions, remembered in this browser only ('' for all courses). */
export function useDailyCourse(): [string, (courseId: string) => void] {
  const [courseId, setCourseId] = useState(() => {
    try {
      return localStorage.getItem(COURSE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const choose = (next: string) => {
    setCourseId(next)
    try {
      localStorage.setItem(COURSE_KEY, next)
    } catch {
      // Not remembered; the choice still applies now.
    }
  }
  return [courseId, choose]
}

/** Which course questions are about: one course, or all of the user's courses. */
export function DailyCourseSelect({
  id,
  value,
  onChange,
}: { id: string; value: string; onChange: (courseId: string) => void }) {
  const { t } = useTranslation()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {t('daily.course')}
      </label>
      <select
        id={id}
        className={`${inputCls} max-w-xs`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('daily.allCourses')}</option>
        {courses.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </>
  )
}

/** "Today's question": made only when you press Generate, at most once a day. */
export function DailyQuestionCard({ showArchiveLink = true }: { showArchiveLink?: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const today = useQuery({ queryKey: ['daily', 'today'], queryFn: api.daily.today })
  const [courseId, setCourseId] = useDailyCourse()
  const generate = useMutation({
    mutationFn: () => api.daily.generate(courseId || undefined),
    onSuccess: (question) => {
      qc.setQueryData(['daily', 'today'], (old: { day: string } | undefined) => ({
        day: old?.day ?? '',
        question,
      }))
      qc.invalidateQueries({ queryKey: ['daily', 'list'] })
    },
  })
  const question = today.data?.question

  return (
    <section
      aria-labelledby="h-daily"
      className="flex flex-col gap-4 rounded-[16px] border border-line bg-surface px-6 py-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="h-daily" className="m-0 text-xl font-bold">
          {t('daily.title')}
        </h2>
        {showArchiveLink && (
          <Link to="/daily" className="text-sm font-semibold">
            {t('daily.more')}
          </Link>
        )}
      </div>
      {question ? (
        <DailyQuestionView question={question} />
      ) : (
        today.data && (
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm text-muted">{t('daily.intro')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <DailyCourseSelect id="daily-course" value={courseId} onChange={setCourseId} />
              <button
                type="button"
                className={btn('ai', 'sm')}
                disabled={generate.isPending}
                onClick={() => generate.mutate()}
              >
                {generate.isPending ? t('daily.generating') : t('daily.generate')}
              </button>
            </div>
            <ErrorNote error={generate.error} />
          </div>
        )
      )}
    </section>
  )
}
