import type { Calculator, FileAsset, PageSummary } from '@nc/shared'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Empty, ErrorNote, FileBadge, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { type CourseOption, useLectureExtras, useTaken } from '../lib/lectures'

type Original = FileAsset & { lectureNumber: number }

/**
 * The original lectures: uploads marked as the original of lecture N (their slides or PDF), in order. Each lists
 * its subset: the pages numbered with that lecture (the article made from it, parts, notes), its example problems
 * and the calculators tagged with it.
 */
export function Lectures() {
  const { t } = useTranslation()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const editable = courses.data?.filter((c) => c.role !== 'viewer') ?? []
  const [editing, setEditing] = useState(false)
  const extras = useLectureExtras()
  const pages = useQueries({
    queries: (courses.data ?? []).map((c) => ({
      queryKey: ['pages', 'course', c.id],
      queryFn: () => api.pages.list(c.id),
    })),
  })
  const groups = (courses.data ?? []).map((course, i) => {
    const coursePages = pages[i]?.data ?? []
    const calculators = extras.calculatorsOf(course.id)
    const originals = extras.originalsOf(course.id) as Original[]
    const numbered = new Set(originals.map((f) => f.lectureNumber))
    const missing = [
      ...new Set(
        [...coursePages, ...calculators]
          .map((p) => p.lectureNumber)
          .filter((n): n is number => n !== null && !numbered.has(n)),
      ),
    ].sort((a, b) => a - b)
    return { course, originals, coursePages, calculators, missing }
  })
  const loaded = courses.data && !extras.isPending && pages.every((p) => !p.isPending)
  const none = loaded && groups.every((g) => !g.originals.length)

  return (
    <div className="flex flex-col gap-8 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-[40px] font-extrabold tracking-[-0.025em]">{t('lectures.title')}</h1>
          <p className="m-0 max-w-[640px] text-muted">{t('lectures.intro')}</p>
        </div>
        {editable.length > 0 && !none && (
          <button
            type="button"
            aria-pressed={editing}
            className={btn(editing ? 'dark' : 'secondary')}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? t('lectures.done') : t('lectures.edit')}
          </button>
        )}
      </header>
      {none && (
        <Empty>
          {t('lectures.none')} <Link to="/files">{t('lectures.toUploads')}</Link>
        </Empty>
      )}
      {groups
        .filter((g) => g.originals.length || g.missing.length)
        .map(({ course, originals, coursePages, calculators, missing }) => (
          <section key={course.id} aria-labelledby={`lec-${course.id}`} className="flex flex-col gap-3">
            <h2 id={`lec-${course.id}`} className="m-0 flex items-center gap-2.5 text-xl font-bold">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: course.color }} />
              <Link
                to="/courses/$courseId"
                params={{ courseId: course.id }}
                className="text-ink no-underline"
              >
                {course.name}
              </Link>
              <span className="text-sm font-normal text-muted">{originals.length}</span>
            </h2>
            <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,360px),1fr))] items-start gap-3 p-0">
              {originals.map((original) => (
                <LectureCard
                  key={original.id}
                  original={original}
                  pages={coursePages.filter((p) => p.lectureNumber === original.lectureNumber)}
                  calculators={calculators.filter((c) => c.lectureNumber === original.lectureNumber)}
                  moveTo={editing && course.role !== 'viewer' ? editable : undefined}
                />
              ))}
            </ol>
            {missing.length > 0 && (
              <p className="m-0 text-sm text-muted">
                {t('lectures.missing', { list: missing.join(', ') })}{' '}
                <Link to="/files">{t('lectures.toUploads')}</Link>
              </p>
            )}
          </section>
        ))}
    </div>
  )
}

/** Move a lecture to another course, or give it another number: its original, and by default all its parts. */
function MoveLecture({
  original,
  courses,
  onDone,
}: { original: Original; courses: CourseOption[]; onDone: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [to, setTo] = useState(courses.find((c) => c.id !== original.courseId)?.id ?? original.courseId)
  const [value, setValue] = useState(String(original.lectureNumber))
  const [withParts, setWithParts] = useState(true)
  const n = Number(value)
  const course = courses.find((c) => c.id === to)
  const { taken, note } = useTaken(course, value.trim() ? n : null, original.id)
  const same = to === original.courseId && n === original.lectureNumber
  const valid = Number.isSafeInteger(n) && n > 0 && !taken && !same
  const move = useMutation({
    mutationFn: () =>
      api.lectures.move({
        courseId: original.courseId,
        lectureNumber: original.lectureNumber,
        toCourseId: to,
        toLectureNumber: n,
        withParts,
      }),
    onSuccess: () => {
      for (const key of ['files', 'pages', 'calculators', 'page']) qc.invalidateQueries({ queryKey: [key] })
      onDone()
    },
  })
  const id = `move-${original.id}`
  return (
    <form
      className="flex flex-col gap-2 rounded-[10px] border border-line-soft bg-surface-2 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) move.mutate()
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-course`} className="text-xs font-semibold text-muted">
            {t('lectures.moveCourse')}
          </label>
          <select
            id={`${id}-course`}
            className={`${inputCls} min-h-9 py-1 text-sm`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-number`} className="text-xs font-semibold text-muted">
            {t('lectures.moveNumber')}
          </label>
          <input
            id={`${id}-number`}
            type="number"
            min={1}
            inputMode="numeric"
            className={`${inputCls} min-h-9 w-24 py-1 text-sm`}
            value={value}
            aria-invalid={taken}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={withParts} onChange={(e) => setWithParts(e.target.checked)} />
        {t('lectures.withParts')}
      </label>
      <p className={`m-0 text-xs ${taken || same ? 'font-semibold text-danger' : 'text-muted'}`}>
        {same ? t('lectures.sameSpot') : note}
      </p>
      <div className="flex gap-2">
        <button type="submit" className={btn('primary', 'sm')} disabled={!valid || move.isPending}>
          {t('lectures.moveSave')}
        </button>
        <button type="button" className={btn('ghost', 'sm')} onClick={onDone}>
          {t('lectures.cancel')}
        </button>
      </div>
      <ErrorNote error={move.error} />
    </form>
  )
}

function LectureCard({
  original,
  pages,
  calculators,
  moveTo,
}: {
  original: Original
  pages: PageSummary[]
  calculators: Calculator[]
  /** In edit mode: the courses it can move to. */
  moveTo?: CourseOption[]
}) {
  const { t } = useTranslation()
  const [moving, setMoving] = useState(false)
  const parts = pages.filter((p) => p.type !== 'seminar')
  const problems = pages.filter((p) => p.type === 'seminar')
  const heading = (text: string) => (
    <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.06em] text-muted">{text}</h3>
  )
  const list = (items: PageSummary[]) => (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((p) => (
        <li key={p.id}>
          <Link to="/pages/$pageId" params={{ pageId: p.id }} className="text-sm">
            {p.title}
          </Link>
        </li>
      ))}
    </ul>
  )
  return (
    <li
      aria-label={t('page.lectureNumber', { n: original.lectureNumber })}
      className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
          {t('page.lectureNumber', { n: original.lectureNumber })}
        </span>
        {moveTo && !moving && (
          <button type="button" className={btn('secondary', 'sm')} onClick={() => setMoving(true)}>
            {t('lectures.move')}
          </button>
        )}
      </div>
      {moveTo && moving && (
        <MoveLecture original={original} courses={moveTo} onDone={() => setMoving(false)} />
      )}
      <a
        href={api.files.url(original.id, true)}
        target="_blank"
        rel="noreferrer"
        aria-label={`${t('lectures.openOriginal')}: ${original.name}`}
        className="flex items-center gap-3 font-semibold text-ink no-underline hover:text-accent"
      >
        <FileBadge name={original.name} />
        <span className="min-w-0 flex-1 truncate">{original.name}</span>
        <span aria-hidden>↗</span>
      </a>
      <div className="flex flex-col gap-1">
        {heading(t('lectures.parts'))}
        {parts.length ? list(parts) : <p className="m-0 text-sm text-muted">{t('lectures.noParts')}</p>}
      </div>
      {problems.length > 0 && (
        <div className="flex flex-col gap-1">
          {heading(t('lectures.problems'))}
          {list(problems)}
        </div>
      )}
      {calculators.length > 0 && (
        <div className="flex flex-col gap-1">
          {heading(t('lectures.calculators'))}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {calculators.map((c) => (
              <li key={c.id}>
                <Link to="/calculators/$calcId" params={{ calcId: c.id }} className="text-sm">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}
