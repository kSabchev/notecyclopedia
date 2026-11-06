import { moveWithinSection, pageSections, problemsPerLecture } from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon, UsersIcon } from '../components/Icons'
import { Card, Empty, ErrorNote, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'

function PageList({ courseId, editing }: { courseId: string; editing: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const pages = useQuery({ queryKey: ['pages', courseId], queryFn: () => api.pages.list(courseId) })
  const [draggedPageId, setDraggedPageId] = useState<string>()
  const reorder = useMutation({
    mutationFn: (pageIds: string[]) => api.pages.reorder(courseId, pageIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pages', courseId] }),
  })
  // Pages move only within their section; the manual order is saved as the sections' order.
  const movePage = (pageId: string | undefined, to: number) => {
    const ids = pageId && pages.data ? moveWithinSection(pages.data, pageId, to) : null
    if (ids) reorder.mutate(ids)
  }
  if (pages.data?.length === 0) return <Empty>{t('home.empty')}</Empty>
  const sections = pageSections(pages.data ?? [])
  const problems = problemsPerLecture(pages.data ?? [])
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <details key={section.type} open className="group flex flex-col gap-2">
          <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1 [&::-webkit-details-marker]:hidden">
            <span className="text-xs text-muted transition-transform group-open:rotate-90">▶</span>
            <h3 className="m-0 text-sm font-bold uppercase tracking-[0.06em] text-ink-2">
              {t(`page.sections.${section.type}`)}
            </h3>
            <span className="text-[13px] text-muted">{section.pages.length}</span>
          </summary>
          <ul className="m-0 flex list-none flex-col rounded-[12px] border border-line bg-surface p-0">
            {section.pages.map((p, i) => {
              // Example problems are grouped under the lecture they practise.
              const lectureHeading =
                section.type === 'seminar' &&
                p.lectureNumber !== section.pages[i - 1]?.lectureNumber &&
                (p.lectureNumber !== null
                  ? t('page.practises', { n: p.lectureNumber })
                  : t('page.practisesNone'))
              const problemCount =
                section.type === 'lecture' && p.lectureNumber !== null
                  ? (problems.get(p.lectureNumber) ?? 0)
                  : 0
              return (
                <li
                  key={p.id}
                  draggable={editing && !reorder.isPending}
                  onDragStart={(event) => {
                    event.stopPropagation()
                    setDraggedPageId(p.id)
                  }}
                  onDragOver={(event) => {
                    if (editing) {
                      event.preventDefault()
                      event.stopPropagation()
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    movePage(draggedPageId, i)
                    setDraggedPageId(undefined)
                  }}
                  onDragEnd={(event) => {
                    event.stopPropagation()
                    setDraggedPageId(undefined)
                  }}
                  className={`${i ? 'border-t border-line-soft' : ''} ${editing ? 'cursor-move' : ''} ${draggedPageId === p.id ? 'opacity-50' : ''}`}
                >
                  {lectureHeading && (
                    <div className="bg-surface-2 px-5 py-1.5 text-xs font-semibold text-muted">
                      {lectureHeading}
                    </div>
                  )}
                  <div className="flex items-center">
                    <Link
                      to="/pages/$pageId"
                      params={{ pageId: p.id }}
                      className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-ink no-underline hover:bg-surface-2"
                    >
                      <span className="min-w-0 flex-1 font-serif text-lg font-semibold">
                        {section.type === 'lecture' && p.lectureNumber !== null && (
                          <span className="mr-2 text-sm font-semibold text-muted">
                            {t('page.lectureNumber', { n: p.lectureNumber })}
                          </span>
                        )}
                        {p.title}
                      </span>
                      {problemCount > 0 && (
                        <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold">
                          {t('page.problemCount', { count: problemCount })}
                        </span>
                      )}
                      {p.tags.map((tag) => (
                        <span key={tag} className="rounded-md bg-line-soft px-2 py-0.5 text-xs">
                          {tag}
                        </span>
                      ))}
                      <span className="text-[13px] text-muted">{timeAgo(p.updatedAt)}</span>
                    </Link>
                    {editing && (
                      <div className="flex shrink-0 gap-1 px-2">
                        <button
                          type="button"
                          aria-label={t('page.moveUp', { name: p.title })}
                          disabled={i === 0 || reorder.isPending}
                          onClick={() => movePage(p.id, i - 1)}
                          className="h-9 w-9 cursor-pointer rounded-lg text-ink hover:bg-line-soft disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={t('page.moveDown', { name: p.title })}
                          disabled={i === section.pages.length - 1 || reorder.isPending}
                          onClick={() => movePage(p.id, i + 1)}
                          className="h-9 w-9 cursor-pointer rounded-lg text-ink hover:bg-line-soft disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          ↓
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </details>
      ))}
      <ErrorNote error={reorder.error} />
    </div>
  )
}

export function Wiki() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const [editing, setEditing] = useState(false)
  const [draggedCourseId, setDraggedCourseId] = useState<string>()
  const reorder = useMutation({
    mutationFn: (courseIds: string[]) => api.courses.reorder(courseIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['courses'] }),
  })
  const moveCourse = (from: number, to: number) => {
    const rows = courses.data
    if (!rows || to < 0 || to >= rows.length || from === to) return
    const courseIds = rows.map((course) => course.id)
    const [moved] = courseIds.splice(from, 1)
    courseIds.splice(to, 0, moved!)
    reorder.mutate(courseIds)
  }
  return (
    <div className="flex flex-col gap-8 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 text-[40px] font-extrabold tracking-[-0.025em]">{t('nav.wiki')}</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={editing}
            className={btn(editing ? 'dark' : 'secondary')}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? t('course.doneOrdering') : t('course.editOrdering')}
          </button>
          <Link to="/pages/new" className={btn('primary')}>
            <PlusIcon />
            {t('nav.newPage')}
          </Link>
        </div>
      </header>
      <ErrorNote error={reorder.error} />
      {courses.data?.length === 0 && <Empty>{t('course.none')}</Empty>}
      {courses.data?.map((c, i) => (
        <section
          key={c.id}
          draggable={editing && !reorder.isPending}
          onDragStart={() => setDraggedCourseId(c.id)}
          onDragOver={(event) => {
            if (editing) event.preventDefault()
          }}
          onDrop={(event) => {
            event.preventDefault()
            const from = courses.data?.findIndex((course) => course.id === draggedCourseId) ?? -1
            moveCourse(from, i)
            setDraggedCourseId(undefined)
          }}
          onDragEnd={() => setDraggedCourseId(undefined)}
          className={`flex flex-col gap-3 ${editing ? 'cursor-move' : ''} ${draggedCourseId === c.id ? 'opacity-50' : ''}`}
          aria-labelledby={`c-${c.id}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={`c-${c.id}`} className="m-0 flex items-center gap-2.5 text-xl font-bold">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c.color }} />
              <Link to="/courses/$courseId" params={{ courseId: c.id }} className="text-ink no-underline">
                {c.name}
              </Link>
            </h2>
            {editing && (
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label={t('course.moveUp', { name: c.name })}
                  disabled={i === 0 || reorder.isPending}
                  onClick={() => moveCourse(i, i - 1)}
                  className="h-9 w-9 cursor-pointer rounded-lg text-ink hover:bg-line-soft disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={t('course.moveDown', { name: c.name })}
                  disabled={i === (courses.data?.length ?? 0) - 1 || reorder.isPending}
                  onClick={() => moveCourse(i, i + 1)}
                  className="h-9 w-9 cursor-pointer rounded-lg text-ink hover:bg-line-soft disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ↓
                </button>
              </div>
            )}
          </div>
          <PageList courseId={c.id} editing={false} />
        </section>
      ))}
    </div>
  )
}

function Members({ courseId, isOwner }: { courseId: string; isOwner: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const members = useQuery({ queryKey: ['members', courseId], queryFn: () => api.courses.members(courseId) })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'editor' | 'viewer'>('editor')
  const invite = useMutation({
    mutationFn: () => api.courses.addMember(courseId, { email, role }),
    onSuccess: () => {
      setEmail('')
      qc.invalidateQueries({ queryKey: ['members', courseId] })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    invite.mutate()
  }
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="m-0 flex items-center gap-2 text-base font-bold">
        <UsersIcon size={18} />
        {t('course.members')}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {members.data?.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              <b className="font-semibold">{m.name}</b> <span className="text-muted">{m.email}</span>
            </span>
            <span className="text-muted">{t(`course.role.${m.role}`)}</span>
          </li>
        ))}
      </ul>
      {isOwner && (
        <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line-soft pt-3">
          <label htmlFor="invite" className="text-[13px] font-semibold text-muted">
            {t('auth.email')}
          </label>
          <input
            id="invite"
            type="email"
            required
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="flex gap-2">
            <label htmlFor="invite-role" className="sr-only">
              Role
            </label>
            <select
              id="invite-role"
              className={`${inputCls} flex-1`}
              value={role}
              onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}
            >
              <option value="editor">{t('course.role.editor')}</option>
              <option value="viewer">{t('course.role.viewer')}</option>
            </select>
            <button type="submit" className={btn('dark')} disabled={invite.isPending}>
              {t('course.invite')}
            </button>
          </div>
          <p className="m-0 text-xs text-muted">{t('course.inviteHint')}</p>
          <ErrorNote error={invite.error} />
        </form>
      )}
    </Card>
  )
}

export function CourseView() {
  const { t } = useTranslation()
  const { courseId } = useParams({ from: '/app/courses/$courseId' })
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const [editing, setEditing] = useState(false)
  const course = courses.data?.find((c) => c.id === courseId)
  if (!course) return <div className="p-10 text-muted">{t('common.loading')}</div>
  return (
    <div className="flex flex-col gap-8 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 flex items-center gap-3 text-[40px] font-extrabold tracking-[-0.025em]">
          <span className="h-4 w-4 rounded" style={{ background: course.color }} />
          {course.name}
        </h1>
        <div className="flex flex-wrap gap-2">
          {course.role !== 'viewer' && (
            <button
              type="button"
              aria-pressed={editing}
              className={btn(editing ? 'dark' : 'secondary')}
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? t('course.doneOrdering') : t('course.editOrdering')}
            </button>
          )}
          {course.role !== 'viewer' && (
            <Link to="/pages/new" search={{ courseId }} className={btn('primary')}>
              <PlusIcon />
              {t('nav.newPage')}
            </Link>
          )}
        </div>
      </header>
      <div className="flex flex-wrap items-start gap-8">
        <div className="min-w-0 flex-[3_1_520px]">
          <PageList courseId={courseId} editing={editing} />
        </div>
        <div className="min-w-0 flex-[1_1_280px]">
          <Members courseId={courseId} isOwner={course.role === 'owner'} />
        </div>
      </div>
    </div>
  )
}
