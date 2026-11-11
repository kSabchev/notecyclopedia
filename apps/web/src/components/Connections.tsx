import type { Calculator } from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { useLectureExtras } from '../lib/lectures'
import { lectureAnchor, usePlanTasks } from '../lib/links'
import { Eyebrow } from './ui'

/** A task's day, short: "Tue 12 Nov". */
export function useShortDay() {
  const { i18n } = useTranslation()
  return (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 text-xs font-semibold text-muted">{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">{children}</ul>
    </div>
  )
}

/**
 * What a page or calculator is connected to: its lecture (and the lecture's original), the other pages of that
 * lecture, the calculators for it, and the exam-prep tasks that point at any of them. Every entry is a link.
 */
export function Connections({
  courseId,
  lectureNumber,
  pageId,
  calculatorId,
}: {
  courseId: string | null
  lectureNumber: number | null
  /** The page shown (left out of the list, and its calculators and tasks included). */
  pageId?: string
  /** The calculator shown. */
  calculatorId?: string
}) {
  const { t } = useTranslation()
  const shortDay = useShortDay()
  const extras = useLectureExtras()
  const tasksFor = usePlanTasks()
  const pages = useQuery({
    queryKey: ['pages', 'course', courseId],
    queryFn: () => api.pages.list(courseId ?? undefined),
    enabled: !!courseId,
  })
  const calculators = useQuery({
    queryKey: ['calculators'],
    queryFn: api.calculators.list,
    select: (rows: Calculator[]) => rows.filter((c) => !c.archivedAt),
  })
  const lecture = courseId && lectureNumber !== null ? lectureNumber : null
  const original = courseId ? extras.original(courseId, lecture) : undefined
  const lecturePages =
    lecture === null ? [] : (pages.data ?? []).filter((p) => p.lectureNumber === lecture && p.id !== pageId)
  const calcs = (calculators.data ?? []).filter(
    (c) =>
      c.id !== calculatorId &&
      ((lecture !== null && c.courseId === courseId && c.lectureNumber === lecture) ||
        (pageId !== undefined && c.sourcePageId === pageId)),
  )
  const pageLecture = (id: string) => pages.data?.find((p) => p.id === id)?.lectureNumber
  const tasks = tasksFor({ courseId, pageId, lectureNumber: lecture, calculatorId }, pageLecture)
  if (lecture === null && !calcs.length && !tasks.length) return null

  return (
    <section aria-labelledby="h-connected" className="flex flex-col gap-3">
      <h2 id="h-connected" className="m-0">
        <Eyebrow>{t('connect.title')}</Eyebrow>
      </h2>
      {lecture !== null && courseId && (
        <Group title={t('connect.lecture')}>
          <li>
            {original ? (
              <Link to="/lectures" hash={lectureAnchor(courseId, lecture)} className="font-semibold">
                {t('page.lectureNumber', { n: lecture })}
              </Link>
            ) : (
              <Link to="/courses/$courseId" params={{ courseId }} className="font-semibold">
                {t('page.lectureNumber', { n: lecture })}
              </Link>
            )}
          </li>
          {original && (
            <li>
              <a href={api.files.url(original.id, true)} target="_blank" rel="noreferrer">
                {t('page.original', { name: original.name })} ↗
              </a>
            </li>
          )}
        </Group>
      )}
      {lecturePages.length > 0 && (
        <Group title={t('connect.pages')}>
          {lecturePages.map((p) => (
            <li key={p.id} className="flex flex-col">
              <Link to="/pages/$pageId" params={{ pageId: p.id }}>
                {p.title}
              </Link>
              <span className="text-xs text-muted">{t(`editor.types.${p.type}`)}</span>
            </li>
          ))}
        </Group>
      )}
      {calcs.length > 0 && (
        <Group title={t('connect.calculators')}>
          {calcs.map((c) => (
            <li key={c.id}>
              <Link to="/calculators/$calcId" params={{ calcId: c.id }}>
                {c.name}
              </Link>
            </li>
          ))}
        </Group>
      )}
      {tasks.length > 0 && (
        <Group title={t('connect.tasks')}>
          {tasks.slice(0, 6).map((task) => (
            <li key={`${task.planId}-${task.item.id}`} className="flex flex-col">
              <Link
                to="/study/$planId"
                params={{ planId: task.planId }}
                className={task.item.done ? 'text-muted line-through' : ''}
              >
                {task.item.focus}
              </Link>
              <span className="text-xs text-muted">
                {task.planTitle} · {shortDay(task.date)}
              </span>
            </li>
          ))}
          {tasks.length > 6 && (
            <li className="text-xs text-muted">{t('connect.more', { count: tasks.length - 6 })}</li>
          )}
        </Group>
      )}
    </section>
  )
}
