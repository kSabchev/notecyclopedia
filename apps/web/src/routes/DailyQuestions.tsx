import type { DailyQuestion } from '@nc/shared'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DailyCourseSelect, DailyQuestionCard, useDailyCourse } from '../components/DailyQuestionCard'
import { DailyQuestionView } from '../components/DailyQuestionView'
import { Empty, ErrorNote, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { useDayLabel } from '../lib/format'

const PAGE = 30

/**
 * Daily questions: today's question, more questions on demand (avoiding topics and questions already asked),
 * and every earlier question, newest first, by day, with a subject filter and text search.
 */
export function DailyQuestions() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [courseId, setCourseId] = useDailyCourse()
  const [filterCourse, setFilterCourse] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(h)
  }, [search])
  const today = useQuery({ queryKey: ['daily', 'today'], queryFn: api.daily.today })
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const list = useInfiniteQuery({
    queryKey: ['daily', 'list', filterCourse, q],
    queryFn: ({ pageParam }) => api.daily.list({ courseId: filterCourse || undefined, q, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })
  const newQuestion = useMutation({
    mutationFn: () => api.daily.ask(courseId || undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['daily', 'list'] }),
  })

  // Today's question is shown in its card above, so the list leaves it out.
  const todayId = today.data?.question?.id
  const questions = (list.data?.pages.flat() ?? []).filter((x) => x.id !== todayId)
  const byDay = new Map<string, DailyQuestion[]>()
  for (const x of questions) byDay.set(x.day, [...(byDay.get(x.day) ?? []), x])
  const date = useDayLabel()

  return (
    <div className="flex max-w-[860px] flex-col gap-8 px-6 pb-18 pt-10 md:px-12">
      <h1 className="m-0 text-[40px] font-extrabold tracking-[-0.025em]">{t('daily.archive')}</h1>
      <DailyQuestionCard showArchiveLink={false} />

      <section
        aria-labelledby="h-new"
        className="flex flex-col gap-3 rounded-[16px] border border-line bg-ai-soft px-6 py-5"
      >
        <h2 id="h-new" className="m-0 text-lg font-bold">
          {t('daily.newQuestion')}
        </h2>
        <p className="m-0 text-sm text-muted">{t('daily.newHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <DailyCourseSelect id="new-course" value={courseId} onChange={setCourseId} />
          <button
            type="button"
            className={btn('ai', 'sm')}
            disabled={newQuestion.isPending}
            onClick={() => newQuestion.mutate()}
          >
            {newQuestion.isPending ? t('daily.generating') : t('daily.ask')}
          </button>
        </div>
        <ErrorNote error={newQuestion.error} />
      </section>

      <section aria-labelledby="h-all" className="flex flex-col gap-4">
        <h2 id="h-all" className="m-0 text-xl font-bold">
          {t('daily.all')}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="daily-search" className="sr-only">
            {t('daily.search')}
          </label>
          <input
            id="daily-search"
            className={`${inputCls} max-w-sm flex-[1_1_220px]`}
            placeholder={t('daily.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {(courses.data?.length ?? 0) > 1 && (
            <div role="group" aria-label={t('formulas.subject')} className="flex flex-wrap gap-2">
              {[null, ...(courses.data ?? [])].map((c) => (
                <button
                  key={c?.id ?? 'all'}
                  type="button"
                  aria-pressed={filterCourse === (c?.id ?? '')}
                  onClick={() => setFilterCourse(c?.id ?? '')}
                  className={`min-h-9 cursor-pointer rounded-full border px-3.5 text-sm font-semibold ${filterCourse === (c?.id ?? '') ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface text-ink'}`}
                >
                  {c?.name ?? t('formulas.allSubjects')}
                </button>
              ))}
            </div>
          )}
        </div>
        {questions.length === 0 && !list.isPending && <Empty>{t('daily.none')}</Empty>}
        {[...byDay].map(([day, items]) => (
          <section key={day} aria-label={date(day)} className="flex flex-col gap-3">
            <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.06em] text-muted">{date(day)}</h3>
            {items.map((x) => (
              <article key={x.id} className="rounded-[16px] border border-line bg-surface px-6 py-5">
                <DailyQuestionView question={x} />
              </article>
            ))}
          </section>
        ))}
        {list.hasNextPage && (
          <button
            type="button"
            className={`${btn('secondary', 'sm')} self-start`}
            disabled={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? t('common.loading') : t('daily.loadMore')}
          </button>
        )}
      </section>
    </div>
  )
}
