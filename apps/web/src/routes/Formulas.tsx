import type { Formula } from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PinStar } from '../components/PinStar'
import { Tex } from '../components/Tex'
import { Empty, inputCls } from '../components/ui'
import { api } from '../lib/api'

/** Formulas grouped by subject (course), then by lecture, in the order the server gives them. */
export function Formulas() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const [courseId, setCourseId] = useState<string | null>(null)
  const formulas = useQuery({ queryKey: ['formulas', 'all'], queryFn: () => api.formulas() })
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const groups = useMemo(() => {
    const f = filter.toLowerCase()
    const shown = (formulas.data ?? []).filter(
      (x) =>
        (!courseId || x.courseId === courseId) &&
        (!f || `${x.latex} ${x.description ?? ''} ${x.label ?? ''} ${x.pageTitle}`.toLowerCase().includes(f)),
    )
    return (courses.data ?? [])
      .map((course) => ({ course, formulas: shown.filter((x) => x.courseId === course.id) }))
      .filter((g) => g.formulas.length > 0)
  }, [formulas.data, courses.data, filter, courseId])
  const coursesWithFormulas = (courses.data ?? []).filter((c) =>
    formulas.data?.some((f) => f.courseId === c.id),
  )

  return (
    <div className="flex flex-col gap-6 px-6 pb-18 pt-10 md:px-12">
      <h1 className="m-0 text-[40px] font-extrabold tracking-[-0.025em]">{t('nav.formulas')}</h1>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="ff" className="sr-only">
          {t('formulas.filter')}
        </label>
        <input
          id="ff"
          className={`${inputCls} max-w-md flex-[1_1_240px]`}
          placeholder={t('formulas.filterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {coursesWithFormulas.length > 1 && (
          <div role="group" aria-label={t('formulas.subject')} className="flex flex-wrap gap-2">
            {[null, ...coursesWithFormulas].map((c) => (
              <button
                key={c?.id ?? 'all'}
                type="button"
                aria-pressed={courseId === (c?.id ?? null)}
                onClick={() => setCourseId(c?.id ?? null)}
                className={`min-h-9 cursor-pointer rounded-full border px-3.5 text-sm font-semibold ${courseId === (c?.id ?? null) ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface text-ink'}`}
              >
                {c?.name ?? t('formulas.allSubjects')}
              </button>
            ))}
          </div>
        )}
      </div>
      {groups.length === 0 && !formulas.isPending && <Empty>{t('home.noPinned')}</Empty>}
      {groups.map(({ course, formulas: rows }) => (
        <section key={course.id} aria-labelledby={`fc-${course.id}`} className="flex flex-col gap-2">
          <h2 id={`fc-${course.id}`} className="m-0 flex items-center gap-2.5 text-xl font-bold">
            <span className="h-3 w-3 rounded-full" style={{ background: course.color }} />
            {course.name}
            <span className="text-sm font-normal text-muted">{rows.length}</span>
          </h2>
          <div className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
            {rows.map((f, i) => (
              <FormulaRow
                key={f.id}
                formula={f}
                first={i === 0}
                heading={lectureHeading(f, rows[i - 1], t)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** A label above the first formula of each lecture, e.g. "Lecture 3". */
function lectureHeading(f: Formula, previous: Formula | undefined, t: TFunction) {
  if (previous && previous.lectureNumber === f.lectureNumber) return null
  return f.lectureNumber !== null ? t('page.lectureNumber', { n: f.lectureNumber }) : t('formulas.otherPages')
}

function FormulaRow({
  formula: f,
  first,
  heading,
}: { formula: Formula; first: boolean; heading: string | null }) {
  return (
    <>
      {heading && (
        <div
          className={`bg-surface-2 px-5 py-1.5 text-xs font-semibold text-muted ${first ? '' : 'border-t border-line-soft'}`}
        >
          {heading}
        </div>
      )}
      <div
        className={`flex flex-col gap-1 px-5 py-4 ${first && !heading ? '' : 'border-t border-line-soft'}`}
      >
        <div className="flex flex-wrap items-center gap-4">
          <Tex latex={f.latex} className="min-w-0 flex-[1_1_280px] overflow-x-auto text-[22px]" />
          {f.label && <span className="font-mono text-sm text-muted">({f.label})</span>}
          <PinStar pageId={f.pageId} nodeId={f.nodeId} pinned={f.pinned} />
          <Link to="/pages/$pageId" params={{ pageId: f.pageId }} className="text-sm font-semibold">
            {f.pageTitle}
          </Link>
        </div>
        {/* Below the formula, so a long description never squeezes it. */}
        {f.description && <p className="m-0 text-sm text-muted">{f.description}</p>}
      </div>
    </>
  )
}
