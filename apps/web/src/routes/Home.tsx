import { AI_MODES, type AiMode } from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDrop } from '../components/FileDrop'
import { PlusIcon, SparkIcon, UploadIcon } from '../components/Icons'
import { Tex } from '../components/Tex'
import { Empty, FileBadge, SectionHeader, btn } from '../components/ui'
import { api } from '../lib/api'
import { timeAgo } from '../lib/format'

export const MODES: readonly AiMode[] = AI_MODES

export function Home() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [mode, setMode] = useState<AiMode>('ask')
  const [q, setQ] = useState('')
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const pages = useQuery({ queryKey: ['pages', 'recent'], queryFn: () => api.pages.list() })
  const pinned = useQuery({ queryKey: ['formulas', 'pinned'], queryFn: () => api.formulas(true) })
  const files = useQuery({ queryKey: ['files', 'recent'], queryFn: () => api.files.list() })
  const calcs = useQuery({ queryKey: ['calculators'], queryFn: api.calculators.list })
  const courseOf = (id: string) => courses.data?.find((c) => c.id === id)
  const firstEditable = courses.data?.find((c) => c.role !== 'viewer')

  return (
    <div className="flex flex-col gap-10 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex max-w-[640px] flex-col gap-2">
          <h1 className="m-0 text-[44px] font-extrabold leading-[1.05] tracking-[-0.025em]">
            {t('home.title')}
          </h1>
          <p className="m-0 text-[17px] text-muted">{t('home.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/files" className={btn('secondary')}>
            <UploadIcon />
            {t('home.upload')}
          </Link>
          <Link to="/pages/new" className={btn('primary')}>
            <PlusIcon />
            {t('home.newNote')}
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-8">
        <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-10">
          <section aria-labelledby="h-continue" className="flex flex-col gap-4">
            <SectionHeader
              id="h-continue"
              title={t('home.continue')}
              action={<Link to="/wiki">{t('home.allPages')}</Link>}
            />
            {pages.data?.length === 0 && <Empty>{t('home.empty')}</Empty>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
              {pages.data?.slice(0, 6).map((p) => {
                const c = courseOf(p.courseId)
                return (
                  <Link
                    key={p.id}
                    to="/pages/$pageId"
                    params={{ pageId: p.id }}
                    className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-5 text-ink no-underline hover:border-line-strong"
                  >
                    <span className="flex items-center gap-2 text-[13px] text-muted">
                      <span className="h-2 w-2 rounded-[2px]" style={{ background: c?.color }} />
                      {c?.name} · {t(`editor.types.${p.type}`)}
                    </span>
                    <span className="font-serif text-[21px] font-semibold leading-tight">{p.title}</span>
                    <span className="text-[13px] text-muted">
                      {t('page.edited', { when: timeAgo(p.updatedAt) })}
                    </span>
                  </Link>
                )
              })}
            </div>
          </section>

          <section aria-labelledby="h-pinned" className="flex flex-col gap-4">
            <SectionHeader
              id="h-pinned"
              title={t('home.pinned')}
              action={<Link to="/formulas">{t('home.formulaIndex')}</Link>}
            />
            {pinned.data?.length === 0 && <Empty>{t('home.noPinned')}</Empty>}
            {!!pinned.data?.length && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
                {pinned.data.slice(0, 6).map((f) => (
                  <div
                    key={f.id}
                    className="graph-paper flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-5"
                  >
                    <Tex latex={f.latex} className="overflow-x-auto text-[22px]" />
                    <span className="font-semibold">{f.description ?? f.pageTitle}</span>
                    <Link to="/pages/$pageId" params={{ pageId: f.pageId }} className="text-sm font-semibold">
                      {f.pageTitle} →
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="h-files" className="flex flex-col gap-4">
            <SectionHeader
              id="h-files"
              title={t('home.recentFiles')}
              action={<Link to="/files">{t('home.manageFiles')}</Link>}
            />
            {files.data?.length === 0 && <Empty>{t('files.none')}</Empty>}
            {!!files.data?.length && (
              <div className="flex flex-col rounded-[12px] border border-line bg-surface">
                {files.data.slice(0, 5).map((f, i) => (
                  <a
                    key={f.id}
                    href={api.files.url(f.id, true)}
                    target="_blank"
                    rel="noreferrer"
                    className={`flex items-center gap-4 px-5 py-3.5 text-ink no-underline hover:bg-surface-2 ${i ? 'border-t border-line' : ''}`}
                  >
                    <FileBadge name={f.name} />
                    <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                    <span className="text-[13px] text-muted">{t(`files.status.${f.status}`)}</span>
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
          <section
            aria-labelledby="h-ask"
            className="flex flex-col gap-4 rounded-[14px] bg-inverse p-6 text-inverse-ink"
          >
            <div className="flex items-center gap-2.5">
              <SparkIcon className="text-ai-on-dark" size={20} />
              <h2 id="h-ask" className="m-0 text-lg font-bold">
                {t('home.ask')}
              </h2>
            </div>
            <div role="group" aria-label="Mode" className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={m === mode}
                  onClick={() => setMode(m)}
                  className={`min-h-10 cursor-pointer rounded-full px-3.5 text-sm font-semibold ${m === mode ? 'border border-ai-on-dark bg-ai-on-dark text-inverse' : 'border border-inverse-chip-line bg-transparent text-inverse-ink'}`}
                >
                  {t(`modes.${m}`)}
                </button>
              ))}
            </div>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (q.trim()) navigate({ to: '/ai', search: { mode, q } })
              }}
            >
              <label htmlFor="ask-box" className="text-[13px] text-inverse-muted">
                {t(`modes.${mode}Hint`)}
              </label>
              <textarea
                id="ask-box"
                rows={4}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="box-border w-full resize-y rounded-[10px] border border-inverse-line bg-inverse-2 p-3.5 text-[15px] text-inverse-ink"
              />
              <button
                type="submit"
                className="min-h-11 cursor-pointer self-end rounded-[10px] bg-ai-on-dark px-5 font-bold text-inverse"
              >
                {t('home.run')}
              </button>
            </form>
          </section>

          <section
            aria-labelledby="h-calcs"
            className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface p-5"
          >
            <div className="flex items-baseline justify-between pb-2">
              <h2 id="h-calcs" className="m-0 text-lg font-bold">
                {t('home.myCalcs')}
              </h2>
              <Link to="/calculators" className="text-sm font-semibold">
                {t('home.library')}
              </Link>
            </div>
            {calcs.data?.length === 0 && <p className="m-0 text-sm text-muted">{t('calc.empty')}</p>}
            {calcs.data?.slice(0, 5).map((c) => (
              <Link
                key={c.id}
                to="/calculators/$calcId"
                params={{ calcId: c.id }}
                className="flex min-h-12 items-center justify-between gap-3 border-b border-line-soft px-1 text-ink no-underline last:border-0"
              >
                <span className="flex items-center gap-2 font-medium">
                  {c.name}
                  {c.origin === 'ai' && (
                    <span className="rounded-[5px] bg-ai-soft px-1.5 py-0.5 text-[11px] font-semibold text-ai-text">
                      {t('calc.aiMade')}
                    </span>
                  )}
                </span>
                <span className="font-mono text-xs text-muted">
                  {c.spec.inputs.length} in · {c.spec.outputs.length} out
                </span>
              </Link>
            ))}
          </section>

          <section aria-label={t('home.drop')}>
            <FileDrop courseId={firstEditable?.id} />
          </section>
        </aside>
      </div>
    </div>
  )
}
