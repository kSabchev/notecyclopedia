import { BUILT_IN_CONSTANTS, type CourseConstant } from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Empty, ErrorNote, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'

type ConstantForm = {
  key: string
  name: string
  symbol: string
  value: string
  unit: string
  description: string
}

const EMPTY_FORM: ConstantForm = { key: '', name: '', symbol: '', value: '', unit: '', description: '' }

function NumberValue({ value }: { value: number }) {
  return <span className="font-mono text-sm">{value.toExponential(8)}</span>
}

export function Constants() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const availableCourses = courses.data ?? []
  const [courseId, setCourseId] = useState('')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<ConstantForm>(EMPTY_FORM)
  const [editing, setEditing] = useState<CourseConstant | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const custom = useQuery({
    queryKey: ['course-constants', courseId],
    queryFn: () => api.courses.constants(courseId),
    enabled: !!courseId,
  })

  useEffect(() => {
    if (!courseId && availableCourses[0]) setCourseId(availableCourses[0].id)
  }, [courseId, availableCourses])

  const save = useMutation({
    mutationFn: () => {
      if (!courseId) throw new Error(t('constants.selectCourse'))
      const body = {
        ...form,
        value: Number(form.value),
        description: form.description.trim() || null,
      }
      if (!Number.isFinite(body.value)) throw new Error(t('constants.invalidValue'))
      return editing
        ? api.courses.updateConstant(courseId, editing.id, body)
        : api.courses.createConstant(courseId, body)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['course-constants', courseId] })
      setEditing(null)
      setForm(EMPTY_FORM)
      setFormOpen(false)
    },
  })
  const remove = useMutation({
    mutationFn: (constantId: string) => api.courses.removeConstant(courseId, constantId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['course-constants', courseId] }),
  })

  const beginEdit = (constant: CourseConstant) => {
    setEditing(constant)
    setForm({
      key: constant.key,
      name: constant.name,
      symbol: constant.symbol,
      value: String(constant.value),
      unit: constant.unit,
      description: constant.description ?? '',
    })
    setFormOpen(true)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }
  const query = search.trim().toLocaleLowerCase()
  const visibleBuiltIns = BUILT_IN_CONSTANTS.filter((constant) =>
    [constant.key, constant.name, constant.symbol, constant.unit].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  )
  const visibleCustom = (custom.data ?? []).filter((constant) =>
    [constant.key, constant.name, constant.symbol, constant.unit].some((value) =>
      value.toLocaleLowerCase().includes(query),
    ),
  )
  const selectedCourse = courses.data?.find((course) => course.id === courseId)

  return (
    <div className="flex flex-col gap-7 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[40px] font-extrabold leading-[1.05] tracking-[-0.025em]">
            {t('constants.title')}
          </h1>
          <p className="m-0 max-w-3xl text-base text-muted">{t('constants.subtitle')}</p>
        </div>
        {selectedCourse?.role !== 'viewer' && selectedCourse && (
          <button
            type="button"
            className={btn('primary')}
            onClick={() => {
              setEditing(null)
              setForm(EMPTY_FORM)
              setFormOpen((open) => !open)
            }}
          >
            {t('constants.add')}
          </button>
        )}
      </header>

      <div role="tablist" aria-label={t('constants.tabs')} className="flex gap-2 border-b border-line">
        <Link
          to="/calculators"
          role="tab"
          aria-selected={false}
          className="border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-muted no-underline"
        >
          {t('calc.title')}
        </Link>
        <Link
          to="/calculators/constants"
          role="tab"
          aria-selected={true}
          className="border-b-2 border-ink px-3 py-2 text-sm font-bold text-ink no-underline"
        >
          {t('constants.title')}
        </Link>
      </div>

      <section className="flex max-w-3xl flex-col gap-5">
        {availableCourses.length > 0 ? (
          <label className="flex max-w-xl flex-col gap-1.5 text-sm font-semibold text-muted">
            {t('constants.course')}
            <select
              className={inputCls}
              value={courseId}
              onChange={(event) => {
                setCourseId(event.target.value)
                setEditing(null)
                setForm(EMPTY_FORM)
                setFormOpen(false)
              }}
            >
              {availableCourses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="m-0 rounded-lg border border-line bg-surface p-4 text-sm text-muted">
            {t('constants.noEditableCourses')}
          </p>
        )}

        {formOpen && selectedCourse?.role !== 'viewer' && (
          <form
            onSubmit={submit}
            className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5"
          >
            <h2 className="m-0 text-lg font-bold">
              {editing ? t('constants.edit') : t('constants.addCustom')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['key', t('calc.key')],
                  ['name', t('constants.name')],
                  ['symbol', t('constants.symbol')],
                  ['value', t('constants.value')],
                  ['unit', t('calc.unit')],
                  ['description', t('constants.description')],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="flex flex-col gap-1.5 text-xs font-semibold text-muted">
                  {label}
                  <input
                    className={inputCls}
                    required={field !== 'description'}
                    type={field === 'value' ? 'number' : 'text'}
                    step={field === 'value' ? 'any' : undefined}
                    value={form[field]}
                    onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
            <p className="m-0 text-xs text-muted">{t('constants.valueHint')}</p>
            <ErrorNote error={save.error} />
            <div className="flex gap-2">
              <button type="submit" className={btn('primary', 'sm')} disabled={save.isPending || !courseId}>
                {save.isPending ? t('constants.saving') : t('calc.save')}
              </button>
              <button
                type="button"
                className={btn('secondary', 'sm')}
                onClick={() => {
                  setFormOpen(false)
                  setEditing(null)
                  setForm(EMPTY_FORM)
                }}
              >
                {t('calc.cancel')}
              </button>
            </div>
          </form>
        )}

        <label className="flex flex-col gap-1.5 text-sm font-semibold text-muted">
          {t('constants.search')}
          <input
            className={inputCls}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <section aria-labelledby="builtin-constants-heading" className="flex flex-col gap-3">
          <h2 id="builtin-constants-heading" className="m-0 text-xl font-bold">
            {t('constants.builtIn')}
          </h2>
          {visibleBuiltIns.map((constant) => (
            <article
              key={constant.key}
              className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 text-base font-bold">
                  {constant.name} <span className="font-serif text-muted">({constant.symbol})</span>
                </h3>
                <NumberValue value={constant.value} />
              </div>
              <div className="flex flex-wrap justify-between gap-2 text-sm text-muted">
                <span>
                  <code>{constant.key}</code> · {constant.unit}
                </span>
                <span>{constant.source}</span>
              </div>
              <p className="m-0 text-sm text-muted">{constant.description}</p>
            </article>
          ))}
          {visibleBuiltIns.length === 0 && <Empty>{t('constants.noMatches')}</Empty>}
        </section>

        {courseId && (
          <section aria-labelledby="course-constants-heading" className="flex flex-col gap-3">
            <h2 id="course-constants-heading" className="m-0 text-xl font-bold">
              {t('constants.courseConstants', { course: selectedCourse?.name ?? '' })}
            </h2>
            <ErrorNote error={custom.error} />
            {visibleCustom.map((constant) => (
              <article
                key={constant.id}
                className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="m-0 text-base font-bold">
                    {constant.name} <span className="font-serif text-muted">({constant.symbol})</span>
                  </h3>
                  <NumberValue value={constant.value} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                  <span>
                    <code>{constant.key}</code> · {constant.unit}
                  </span>
                  {selectedCourse?.role !== 'viewer' && (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        className="text-accent underline"
                        onClick={() => beginEdit(constant)}
                      >
                        {t('calc.edit')}
                      </button>
                      <button
                        type="button"
                        className="text-danger underline"
                        onClick={() =>
                          window.confirm(t('constants.confirmDelete', { name: constant.name })) &&
                          remove.mutate(constant.id)
                        }
                      >
                        {t('calc.delete')}
                      </button>
                    </span>
                  )}
                </div>
                {constant.description && <p className="m-0 text-sm text-muted">{constant.description}</p>}
              </article>
            ))}
            {!custom.isPending && visibleCustom.length === 0 && (
              <Empty>{query ? t('constants.noMatches') : t('constants.empty')}</Empty>
            )}
            <ErrorNote error={remove.error} />
          </section>
        )}
      </section>
    </div>
  )
}
