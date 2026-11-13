import { parseCalculatorJson } from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Empty, ErrorNote, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'

import { CalculatorDetail } from '../components/calculator/CalculatorDetail'

export function Calculators() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { calcId?: string }
  const [filter, setFilter] = useState<'all' | 'ai' | 'archived'>('all')
  const [sort, setSort] = useState<'course' | 'name' | 'edited'>('course')
  const search = useSearch({ strict: false }) as { course?: string }
  // From a course page: "Calculators" opens the library filtered to that course.
  const [shownCourse, setShownCourse] = useState(search.course ?? '')
  const [creating, setCreating] = useState(false)
  const list = useQuery({ queryKey: ['calculators'], queryFn: api.calculators.list })
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const courseName = (id: string | null) =>
    (id && courses.data?.find((c) => c.id === id)?.name) || t('calc.personal')
  // Courses in their own order, untagged calculators last.
  const courseOrder = (id: string | null) => {
    const i = id ? (courses.data?.findIndex((c) => c.id === id) ?? -1) : -1
    return i < 0 ? Number.POSITIVE_INFINITY : i
  }
  const importJson = useMutation({
    mutationFn: async (file: File) => {
      const { spec, error } = parseCalculatorJson(await file.text())
      if (!spec) throw new Error(`${t('calc.invalid')}: ${error}`)
      return api.calculators.create({ spec })
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['calculators'] })
      navigate({ to: '/calculators/$calcId', params: { calcId: c.id } })
    },
  })

  const shown = (list.data ?? [])
    .filter((c) => (filter === 'archived' ? c.archivedAt : !c.archivedAt))
    .filter((c) => filter !== 'ai' || c.origin === 'ai')
    .filter((c) => !shownCourse || (shownCourse === 'none' ? !c.courseId : c.courseId === shownCourse))
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'course'
          ? courseOrder(a.courseId) - courseOrder(b.courseId) ||
            (a.lectureNumber ?? Number.POSITIVE_INFINITY) - (b.lectureNumber ?? Number.POSITIVE_INFINITY) ||
            a.name.localeCompare(b.name)
          : 0,
    )
  const selected = list.data?.find((c) => c.id === params.calcId) ?? (creating ? null : (shown[0] ?? null))

  return (
    <div className="flex flex-col gap-7 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[40px] font-extrabold leading-[1.05] tracking-[-0.025em]">
            {t('calc.title')}
          </h1>
          <p className="m-0 text-base text-muted">{t('calc.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <label className={btn('secondary')}>
            {t('calc.import')}
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => e.target.files?.[0] && importJson.mutate(e.target.files[0])}
            />
          </label>
          <button
            type="button"
            className={btn('primary')}
            onClick={() => {
              setCreating(true)
              navigate({ to: '/calculators' })
            }}
          >
            {t('calc.new')}
          </button>
        </div>
      </header>
      <div role="tablist" aria-label={t('constants.tabs')} className="flex gap-2 border-b border-line">
        <Link
          to="/calculators"
          role="tab"
          aria-selected={true}
          className="border-b-2 border-ink px-3 py-2 text-sm font-bold text-ink no-underline"
        >
          {t('calc.title')}
        </Link>
        <Link
          to="/calculators/constants"
          role="tab"
          aria-selected={false}
          className="border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-muted no-underline"
        >
          {t('constants.title')}
        </Link>
      </div>
      <ErrorNote error={importJson.error} />

      <div className="flex flex-wrap items-start gap-7">
        <section aria-label={t('calc.title')} className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {(['all', 'ai', 'archived'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`min-h-9 cursor-pointer rounded-full border px-3.5 text-sm font-semibold ${filter === f ? 'border-inverse bg-inverse text-inverse-ink' : 'border-line-strong bg-surface text-ink'}`}
              >
                {f === 'all' ? t('calc.all') : f === 'ai' ? t('calc.aiMade') : t('calc.archivedFilter')}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              {t('calc.sortBy')}
              <select
                className={`${inputCls} min-h-9 py-1 text-sm`}
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
              >
                <option value="course">{t('calc.sortCourse')}</option>
                <option value="name">{t('calc.sortName')}</option>
                <option value="edited">{t('calc.sortEdited')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              {t('calc.filterCourse')}
              <select
                className={`${inputCls} min-h-9 py-1 text-sm`}
                value={shownCourse}
                onChange={(e) => setShownCourse(e.target.value)}
              >
                <option value="">{t('calc.allCourses')}</option>
                {courses.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="none">{t('calc.personal')}</option>
              </select>
            </label>
          </div>
          {shown.length === 0 && !list.isPending && <Empty>{t('calc.empty')}</Empty>}
          {shown.map((c, i) => (
            <Fragment key={c.id}>
              {sort === 'course' && c.courseId !== shown[i - 1]?.courseId && (
                <h3 className="m-0 mt-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  {courseName(c.courseId)}
                </h3>
              )}
              <Link
                key={c.id}
                to="/calculators/$calcId"
                params={{ calcId: c.id }}
                onClick={() => setCreating(false)}
                aria-current={selected?.id === c.id ? 'true' : undefined}
                className={`flex flex-col items-start gap-1.5 rounded-[12px] bg-surface px-4.5 py-4 text-ink no-underline ${selected?.id === c.id ? 'border-2 border-accent' : 'border border-line'}`}
              >
                <span className="flex items-center gap-2 text-base font-bold">
                  {c.name}
                  {c.origin === 'ai' && (
                    <span className="rounded-[5px] bg-ai-soft px-1.5 py-0.5 text-[11px] font-semibold text-ai-text">
                      {t('calc.aiMade')}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[13px] text-accent">
                  {c.spec.outputs.map((o) => o.key).join(', ')} = f(
                  {c.spec.inputs.map((i) => i.key).join(', ')})
                </span>
                <span className="text-[13px] text-muted">
                  {[
                    courseName(c.courseId),
                    c.courseId && c.lectureNumber !== null && t('page.lectureNumber', { n: c.lectureNumber }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </Link>
            </Fragment>
          ))}
        </section>
        {(selected || creating) && (
          <CalculatorDetail
            calc={creating && !params.calcId ? null : selected}
            isNew={creating && !params.calcId}
            onCancelNew={() => setCreating(false)}
          />
        )}
      </div>
    </div>
  )
}
