import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DocView, docHeadings } from '../components/DocView'
import { FileDrop } from '../components/FileDrop'
import { PenIcon, SparkIcon } from '../components/Icons'
import { Eyebrow, FileBadge, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'

type Tab = 'read' | 'source' | 'history'

export function PageView() {
  const { t } = useTranslation()
  const { pageId } = useParams({ from: '/app/pages/$pageId' })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('read')
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const page = useQuery({ queryKey: ['page', pageId], queryFn: () => api.pages.get(pageId) })
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const files = useQuery({
    queryKey: ['files', 'page', pageId],
    queryFn: () => api.files.list({ pageId }),
    refetchInterval: (q) =>
      q.state.data?.some((f) => f.status === 'uploaded' || f.status === 'processing') ? 2000 : false,
  })
  const revisions = useQuery({
    queryKey: ['revisions', pageId],
    queryFn: () => api.pages.revisions(pageId),
    enabled: tab === 'history',
  })
  const remove = useMutation({
    mutationFn: () => api.pages.remove(pageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pages'] })
      navigate({ to: '/wiki' })
    },
  })
  const move = useMutation({
    mutationFn: () => api.pages.move(pageId, moveTarget),
    onSuccess: async (moved) => {
      qc.setQueryData(['page', pageId], moved)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['pages'] }),
        qc.invalidateQueries({ queryKey: ['files'] }),
        qc.invalidateQueries({ queryKey: ['formulas'] }),
        qc.invalidateQueries({ queryKey: ['calculators'] }),
      ])
      setMoveTarget('')
    },
  })

  if (page.isPending) return <div className="p-10 text-muted">{t('common.loading')}</div>
  if (page.error) return <div className="p-10 text-danger">{page.error.message}</div>
  const p = page.data
  const course = courses.data?.find((c) => c.id === p.courseId)
  const canEdit = course && course.role !== 'viewer'
  const moveCourses = courses.data?.filter((item) => item.role !== 'viewer' && item.id !== p.courseId) ?? []
  const headings = docHeadings(p.content)
  const aiLink = (mode: 'summarize' | 'ask' | 'solve' | 'calculator', q: string) => ({
    to: '/ai' as const,
    search: { mode, q, pageId: p.id },
  })

  const tabs: Tab[] = ['read', 'source', 'history']
  return (
    <div className="flex flex-wrap items-start gap-12 px-6 pb-18 pt-8 md:px-12">
      <article className="flex min-w-0 max-w-[760px] flex-[3_1_520px] flex-col gap-6">
        <div className="text-sm text-muted">
          {course && (
            <Link to="/courses/$courseId" params={{ courseId: course.id }} className="text-muted">
              {course.name}
            </Link>
          )}{' '}
          / {t(`editor.types.${p.type}`)}
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="m-0 font-serif text-[46px] font-semibold leading-[1.08] tracking-[-0.015em]">
            {p.title}
          </h1>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
            <span>{t('page.edited', { when: timeAgo(p.updatedAt) })}</span>
            <span>{t('page.revision', { n: p.revision })}</span>
            {p.tags.map((tag) => (
              <span key={tag} className="rounded-md bg-line-soft px-2 text-ink">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line">
          <div role="tablist" aria-label="Page view" className="flex gap-1">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`-mb-px min-h-11 cursor-pointer border-b-2 px-3.5 text-[15px] ${tab === id ? 'border-ink font-bold text-ink' : 'border-transparent font-medium text-muted'}`}
              >
                {t(`page.${id}`)}
              </button>
            ))}
          </div>
          <div className="flex gap-2 pb-2">
            <Link
              {...aiLink('summarize', t('page.shortSummary'))}
              className={`${btn('ghost', 'sm')} bg-ai-soft text-ai-text`}
            >
              <SparkIcon size={16} />
              {t('page.summarize')}
            </Link>
            {canEdit && (
              <Link to="/pages/$pageId/edit" params={{ pageId: p.id }} className={btn('dark', 'sm')}>
                <PenIcon size={16} />
                {t('page.edit')}
              </Link>
            )}
          </div>
        </div>

        {tab === 'read' && <DocView doc={p.content} />}

        {tab === 'source' && (
          <div className="flex flex-col gap-3">
            {files.data?.length === 0 && <p className="m-0 text-muted">{t('page.noFiles')}</p>}
            {files.data?.map((f) => (
              <div
                key={f.id}
                className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-surface px-4 py-3"
              >
                <FileBadge name={f.name} />
                <button
                  type="button"
                  className="min-h-11 flex-1 cursor-pointer text-left font-semibold"
                  onClick={() => setOpenFile(openFile === f.id ? null : f.id)}
                >
                  {f.name}
                </button>
                <span className="text-xs text-muted">{t(`files.status.${f.status}`)}</span>
                <a href={api.files.url(f.id)} className="text-sm font-semibold">
                  {t('files.download')}
                </a>
              </div>
            ))}
            {openFile && files.data?.find((f) => f.id === openFile)?.mime === 'application/pdf' && (
              <iframe
                title="PDF"
                src={api.files.url(openFile, true)}
                className="h-[80vh] w-full rounded-[12px] border border-line bg-surface"
              />
            )}
            {openFile && files.data?.find((f) => f.id === openFile)?.mime.startsWith('image/') && (
              <img
                alt=""
                src={api.files.url(openFile, true)}
                className="max-w-full rounded-[12px] border border-line"
              />
            )}
            {canEdit && <FileDrop courseId={p.courseId} pageId={p.id} compact />}
          </div>
        )}

        {tab === 'history' && (
          <ol className="m-0 flex list-none flex-col rounded-[12px] border border-line bg-surface p-0">
            {revisions.data?.map((r, i) => (
              <li
                key={r.id}
                className={`flex flex-wrap gap-x-5 gap-y-2 px-5 py-4 ${i ? 'border-t border-line-soft' : ''}`}
              >
                <span className="font-mono text-[13px] text-muted">r{r.revision}</span>
                <span className="flex-1 font-medium">{r.message ?? r.title}</span>
                <span className="text-sm text-muted">
                  {timeAgo(r.createdAt)} · {r.authorName}
                </span>
              </li>
            ))}
          </ol>
        )}

        {canEdit && tab === 'read' && (
          <div className="border-t border-line-soft pt-6">
            <button
              type="button"
              className="min-h-11 cursor-pointer text-sm text-danger underline"
              onClick={() => window.confirm(t('page.confirmDelete')) && remove.mutate()}
            >
              {t('page.delete')}
            </button>
          </div>
        )}

        {canEdit && moveCourses.length > 0 && (
          <section className="flex flex-col gap-3 border-t border-line-soft pt-5">
            <label htmlFor="move-course" className="text-sm font-semibold text-muted">
              {t('page.moveToCourse')}
            </label>
            <div className="flex flex-wrap gap-2">
              <select
                id="move-course"
                className={`${inputCls} min-w-0 flex-1`}
                value={moveTarget}
                onChange={(event) => setMoveTarget(event.target.value)}
              >
                <option value="">{t('page.selectCourse')}</option>
                {moveCourses.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={btn('secondary', 'sm')}
                disabled={!moveTarget || move.isPending}
                onClick={() => {
                  const targetName = moveCourses.find((item) => item.id === moveTarget)?.name
                  if (targetName && window.confirm(t('page.confirmMove', { course: targetName })))
                    move.mutate()
                }}
              >
                {move.isPending ? t('page.moving') : t('page.move')}
              </button>
            </div>
            <p className="m-0 text-xs text-muted">{t('page.moveHint')}</p>
            {move.error && (
              <p role="alert" className="m-0 text-sm text-danger">
                {move.error.message}
              </p>
            )}
          </section>
        )}
      </article>

      <aside className="flex min-w-0 flex-[1_1_260px] flex-col gap-7 pt-10">
        {headings.length > 0 && (
          <nav aria-labelledby="h-toc" className="flex flex-col gap-2">
            <h2 id="h-toc" className="m-0 mb-1">
              <Eyebrow>{t('page.onThisPage')}</Eyebrow>
            </h2>
            {headings.map((h) => (
              <span key={h.index} className={`text-sm ${h.level === 3 ? 'pl-3 text-muted' : ''}`}>
                {h.text}
              </span>
            ))}
          </nav>
        )}
        <section
          aria-labelledby="h-ai"
          className="flex flex-col gap-2 rounded-[12px] bg-ink p-4.5 text-white"
        >
          <h2 id="h-ai" className="m-0 mb-1.5 flex items-center gap-2 text-[15px] font-bold">
            <SparkIcon size={16} className="text-ai-on-dark" />
            {t('page.aiOnPage')}
          </h2>
          {(
            [
              ['summarize', 'page.shortSummary'],
              ['ask', 'page.explain'],
              ['solve', 'page.practice'],
              ['calculator', 'page.buildCalcs'],
            ] as const
          ).map(([mode, key]) => (
            <Link
              key={key}
              {...aiLink(mode, t(key))}
              className="flex min-h-10 items-center rounded-lg bg-ink-2 px-3 text-sm text-white no-underline hover:text-white hover:brightness-125"
            >
              {t(key)}
            </Link>
          ))}
        </section>
        <section aria-labelledby="h-files" className="flex flex-col gap-2.5">
          <h2 id="h-files" className="m-0">
            <Eyebrow>{t('page.files')}</Eyebrow>
          </h2>
          {files.data?.map((f) => (
            <a
              key={f.id}
              href={api.files.url(f.id, true)}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 text-sm text-ink no-underline"
            >
              <FileBadge name={f.name} />
              <span className="truncate">{f.name}</span>
            </a>
          ))}
          {canEdit && (
            <button
              type="button"
              className="cursor-pointer self-start text-sm font-semibold text-accent"
              onClick={() => setTab('source')}
            >
              {t('page.attach')}
            </button>
          )}
        </section>
      </aside>
    </div>
  )
}
