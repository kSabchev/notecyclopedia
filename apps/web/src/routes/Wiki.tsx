import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon, UsersIcon } from '../components/Icons'
import { Card, Empty, ErrorNote, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'

function PageList({ courseId }: { courseId?: string }) {
  const { t } = useTranslation()
  const pages = useQuery({ queryKey: ['pages', courseId ?? 'all'], queryFn: () => api.pages.list(courseId) })
  if (pages.data?.length === 0) return <Empty>{t('home.empty')}</Empty>
  return (
    <ul className="m-0 flex list-none flex-col rounded-[12px] border border-line bg-surface p-0">
      {pages.data?.map((p, i) => (
        <li key={p.id} className={i ? 'border-t border-line-soft' : ''}>
          <Link
            to="/pages/$pageId"
            params={{ pageId: p.id }}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-ink no-underline hover:bg-surface-2"
          >
            <span className="min-w-0 flex-1 font-serif text-lg font-semibold">{p.title}</span>
            <span className="text-[13px] text-muted">{t(`editor.types.${p.type}`)}</span>
            {p.tags.map((tag) => (
              <span key={tag} className="rounded-md bg-line-soft px-2 py-0.5 text-xs">
                {tag}
              </span>
            ))}
            <span className="text-[13px] text-muted">{timeAgo(p.updatedAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function Wiki() {
  const { t } = useTranslation()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  return (
    <div className="flex max-w-[1100px] flex-col gap-8 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 text-[40px] font-extrabold tracking-[-0.025em]">{t('nav.wiki')}</h1>
        <Link to="/pages/new" className={btn('primary')}>
          <PlusIcon />
          {t('nav.newPage')}
        </Link>
      </header>
      {courses.data?.length === 0 && <Empty>{t('course.none')}</Empty>}
      {courses.data?.map((c) => (
        <section key={c.id} className="flex flex-col gap-3" aria-labelledby={`c-${c.id}`}>
          <h2 id={`c-${c.id}`} className="m-0 flex items-center gap-2.5 text-xl font-bold">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c.color }} />
            <Link to="/courses/$courseId" params={{ courseId: c.id }} className="text-ink no-underline">
              {c.name}
            </Link>
          </h2>
          <PageList courseId={c.id} />
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
  const course = courses.data?.find((c) => c.id === courseId)
  if (!course) return <div className="p-10 text-muted">{t('common.loading')}</div>
  return (
    <div className="flex flex-col gap-8 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 flex items-center gap-3 text-[40px] font-extrabold tracking-[-0.025em]">
          <span className="h-4 w-4 rounded" style={{ background: course.color }} />
          {course.name}
        </h1>
        {course.role !== 'viewer' && (
          <Link to="/pages/new" search={{ courseId }} className={btn('primary')}>
            <PlusIcon />
            {t('nav.newPage')}
          </Link>
        )}
      </header>
      <div className="flex flex-wrap items-start gap-8">
        <div className="min-w-0 flex-[3_1_520px]">
          <PageList courseId={courseId} />
        </div>
        <div className="min-w-0 flex-[1_1_280px]">
          <Members courseId={courseId} isOwner={course.role === 'owner'} />
        </div>
      </div>
    </div>
  )
}
