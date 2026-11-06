import { type ExamPlan, planFileSchema } from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { useSession } from '../lib/auth'
import { ErrorNote, btn, inputCls } from './ui'

// Plans are shared as copies: each student keeps their own progress. See packages/shared/src/plan-file.ts.

/** Copies of plans other course members sent you, to accept (they become yours) or decline. */
export function SharedWithYou() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const shares = useQuery({ queryKey: ['study', 'shares'], queryFn: api.study.shares })
  const accept = useMutation({
    mutationFn: api.study.acceptShare,
    onSuccess: (plan) => {
      qc.invalidateQueries({ queryKey: ['study'] })
      navigate({ to: '/study/$planId', params: { planId: plan.id } })
    },
  })
  const decline = useMutation({
    mutationFn: api.study.declineShare,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['study', 'shares'] }),
  })
  if (!shares.data?.length) return null
  return (
    <section aria-labelledby="h-shared" className="flex flex-col gap-3">
      <h2 id="h-shared" className="m-0 text-lg font-bold">
        {t('study.sharedTitle')}
      </h2>
      <ul className="m-0 flex list-none flex-col rounded-[12px] border border-line bg-surface p-0">
        {shares.data.map((s, i) => (
          <li
            key={s.id}
            className={`flex flex-wrap items-center gap-3 px-5 py-3.5 ${i ? 'border-t border-line' : ''}`}
          >
            <span className="min-w-0 flex-1">
              {t('study.sharedFrom', { name: s.fromName, title: s.title, date: s.examDate, count: s.tasks })}
            </span>
            <button
              type="button"
              className={btn('primary', 'sm')}
              disabled={accept.isPending}
              onClick={() => accept.mutate(s.id)}
            >
              {t('study.accept')}
            </button>
            <button
              type="button"
              className={btn('secondary', 'sm')}
              disabled={decline.isPending}
              onClick={() => decline.mutate(s.id)}
            >
              {t('study.decline')}
            </button>
          </li>
        ))}
      </ul>
      <ErrorNote error={accept.error ?? decline.error} />
    </section>
  )
}

/** A plan from an exported file, into one of your courses; tasks are linked to that course's pages. No AI. */
export function ImportPlan({ courses }: { courses: { id: string; name: string }[] }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [courseId, setCourseId] = useState('')
  const [keepProgress, setKeepProgress] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const chosen = courseId || courses[0]?.id || ''
  const run = useMutation({
    mutationFn: async (file: File) => {
      let plan: unknown
      try {
        plan = planFileSchema.parse(JSON.parse(await file.text()))
      } catch {
        throw new Error(t('study.badFile'))
      }
      return api.study.importPlan(chosen, plan, keepProgress)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['study', 'plans'] }),
    onError: setError,
  })
  return (
    <details className="rounded-[12px] border border-line bg-surface">
      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold">{t('study.importTitle')}</summary>
      <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-48 flex-col gap-1 text-[13px] font-semibold text-muted">
            {t('study.importCourse')}
            <select className={inputCls} value={chosen} onChange={(e) => setCourseId(e.target.value)}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-[18px] w-[18px] accent-accent"
              checked={keepProgress}
              onChange={(e) => setKeepProgress(e.target.checked)}
            />
            {t('study.keepProgress')}
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
            {t('study.importFile')}
            <input
              type="file"
              accept="application/json,.json"
              disabled={!chosen || run.isPending}
              className="text-sm text-ink"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                setError(null)
                if (file) run.mutate(file)
              }}
            />
          </label>
        </div>
        {run.isPending && <p className="m-0 text-sm text-muted">{t('study.importing')}</p>}
        {run.data && (
          <p role="status" className="m-0 text-sm">
            {t('study.imported', { title: run.data.plan.title })}{' '}
            {run.data.unlinked > 0 &&
              t('study.importLinks', { linked: run.data.linked, unlinked: run.data.unlinked })}{' '}
            <Link to="/study/$planId" params={{ planId: run.data.plan.id }} className="font-semibold">
              {t('study.openPlan')} →
            </Link>
          </p>
        )}
        <ErrorNote error={error} />
      </div>
    </details>
  )
}

/** Pause or resume, export, and share a copy with another member of the course. */
export function PlanActions({ plan, onChange }: { plan: ExamPlan; onChange: (plan: ExamPlan) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const session = useSession()
  const members = useQuery({
    queryKey: ['members', plan.courseId],
    queryFn: () => api.courses.members(plan.courseId),
  })
  const others = members.data?.filter((m) => m.userId !== session.data?.user.id) ?? []
  const [to, setTo] = useState('')
  const toggle = useMutation({
    mutationFn: () => api.study.setPlanActive(plan.id, !plan.active),
    onSuccess: (saved) => {
      onChange(saved)
      qc.invalidateQueries({ queryKey: ['study'] })
    },
  })
  const recipient = to || others[0]?.userId || ''
  const share = useMutation({ mutationFn: () => api.study.sharePlan(plan.id, recipient) })
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btn('secondary', 'sm')}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {plan.active ? t('study.pause') : t('study.resume')}
        </button>
        <a href={api.study.exportUrl(plan.id)} download className={btn('secondary', 'sm')}>
          {t('study.export')}
        </a>
      </div>
      {!plan.active && (
        <p role="status" className="m-0 rounded-[10px] bg-line-soft px-4 py-2.5 text-sm">
          {t('study.pausedNote')}
        </p>
      )}
      <details className="rounded-[12px] border border-line">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold">{t('study.share')}</summary>
        <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
          <p className="m-0 text-sm text-muted">{t('study.shareHint')}</p>
          {members.data && !others.length ? (
            <p className="m-0 text-sm">{t('study.noMembers')}</p>
          ) : (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (recipient) share.mutate()
              }}
            >
              <label className="flex min-w-56 flex-col gap-1 text-[13px] font-semibold text-muted">
                {t('study.shareWith')}
                <select
                  className={inputCls}
                  value={recipient}
                  onChange={(e) => {
                    setTo(e.target.value)
                    share.reset()
                  }}
                >
                  {others.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name} ({m.email})
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={btn('primary', 'sm')} disabled={!recipient || share.isPending}>
                {t('study.send')}
              </button>
            </form>
          )}
          {share.isSuccess && (
            <p role="status" className="m-0 text-sm">
              {t('study.sent', { name: others.find((m) => m.userId === recipient)?.name ?? '' })}
            </p>
          )}
          <ErrorNote error={share.error ?? toggle.error} />
        </div>
      </details>
    </div>
  )
}
