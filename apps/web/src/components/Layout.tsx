import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setLanguage } from '../i18n'
import { api } from '../lib/api'
import { signOut, useSession } from '../lib/auth'
import { BookIcon, CalcIcon, HomeIcon, PlusIcon, SearchIcon, SigmaIcon, SparkIcon, UploadIcon } from './Icons'
import { SearchDialog } from './SearchDialog'
import { btn, inputCls } from './ui'

const COLORS = ['#1F3FBF', '#B85C00', '#16181D', '#2F7D4F', '#7A3FB8']

const navCls =
  'flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-ink no-underline hover:bg-bg data-[status=active]:bg-accent-soft data-[status=active]:font-semibold data-[status=active]:text-accent'

export function Brand() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 px-2">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-ink font-serif text-[22px] italic text-white"
        aria-hidden="true"
      >
        ∑
      </div>
      <div className="flex flex-col">
        <span className="text-[17px] font-extrabold tracking-[-0.01em]">{t('app.name')}</span>
        <span className="text-xs text-muted">{t('app.tagline')}</span>
      </div>
    </div>
  )
}

function NewCourse({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const create = useMutation({
    mutationFn: () => api.courses.create({ name, color }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courses'] })
      onDone()
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) create.mutate()
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-[10px] border border-line bg-bg p-3">
      <label htmlFor="new-course" className="text-[13px] font-semibold text-muted">
        {t('course.name')}
      </label>
      <input
        id="new-course"
        autoFocus
        className={inputCls}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div role="radiogroup" aria-label="Color" className="flex gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === color}
            aria-label={c}
            onClick={() => setColor(c)}
            className={`h-7 w-7 rounded-md border-2 ${c === color ? 'border-ink' : 'border-transparent'}`}
            style={{ background: c }}
          />
        ))}
      </div>
      <button type="submit" className={btn('primary', 'sm')} disabled={create.isPending}>
        {t('course.create')}
      </button>
    </form>
  )
}

export function Layout() {
  const { t, i18n } = useTranslation()
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const [searchOpen, setSearchOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list, enabled: !!session })

  useEffect(() => {
    if (!isPending && !session) navigate({ to: '/login' })
  }, [isPending, session, navigate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (isPending || !session) return <div className="p-10 text-muted">{t('common.loading')}</div>

  return (
    <div className="flex min-h-screen flex-wrap items-stretch">
      <nav
        aria-label="Main"
        className="box-border flex flex-[1_1_248px] flex-col gap-6 border-r border-line bg-surface px-4 py-6 md:max-w-[280px]"
      >
        <Brand />
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex h-11 cursor-pointer items-center gap-2.5 rounded-[10px] border border-line bg-bg px-3 text-left text-sm text-muted"
        >
          <SearchIcon />
          <span className="flex-1">{t('nav.search')}</span>
          <kbd className="rounded-[5px] border border-line bg-surface px-1.5 font-mono text-xs">Ctrl K</kbd>
        </button>
        <div className="flex flex-col gap-0.5">
          <Link to="/" className={navCls} activeOptions={{ exact: true }}>
            <HomeIcon />
            {t('nav.home')}
          </Link>
          <Link to="/wiki" className={navCls}>
            <BookIcon />
            {t('nav.wiki')}
          </Link>
          <Link to="/formulas" className={navCls}>
            <SigmaIcon />
            {t('nav.formulas')}
          </Link>
          <Link to="/calculators" className={navCls}>
            <CalcIcon />
            {t('nav.calculators')}
          </Link>
          <Link to="/ai" className={navCls}>
            <SparkIcon />
            {t('nav.ai')}
          </Link>
          <Link to="/files" className={navCls}>
            <UploadIcon />
            {t('nav.files')}
          </Link>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-3">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              {t('nav.courses')}
            </span>
            <button
              type="button"
              aria-label={t('nav.newCourse')}
              onClick={() => setAdding((a) => !a)}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-bg"
            >
              <PlusIcon size={16} />
            </button>
          </div>
          {adding && <NewCourse onDone={() => setAdding(false)} />}
          {courses.data?.map((c) => (
            <Link
              key={c.id}
              to="/courses/$courseId"
              params={{ courseId: c.id }}
              className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-ink no-underline hover:bg-bg data-[status=active]:font-semibold"
            >
              <span className="h-2 w-2 rounded-[2px]" style={{ background: c.color }} />
              {c.name}
            </Link>
          ))}
          {courses.data?.length === 0 && !adding && (
            <p className="m-0 px-3 text-sm text-muted">{t('course.none')}</p>
          )}
        </div>
        <div className="mt-auto flex flex-col gap-2 px-2">
          <Link to="/pages/new" className={btn('dark')}>
            <PlusIcon />
            {t('nav.newPage')}
          </Link>
          <div className="flex items-center justify-between gap-2 text-sm">
            <button
              type="button"
              className="min-h-11 cursor-pointer text-muted underline"
              onClick={() => setLanguage(i18n.language === 'bg' ? 'en' : 'bg')}
            >
              {t('nav.language')}
            </button>
            <button
              type="button"
              className="min-h-11 cursor-pointer text-muted underline"
              onClick={async () => {
                await signOut()
                navigate({ to: '/login' })
              }}
            >
              {t('nav.signOut')}
            </button>
          </div>
          <span className="truncate text-xs text-muted">
            {session.user.name} · {session.user.email}
          </span>
        </div>
      </nav>
      <main className="box-border min-w-0 flex-[999_1_560px]">
        <Outlet />
      </main>
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
