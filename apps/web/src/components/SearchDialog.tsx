import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { CloseIcon, SearchIcon } from './Icons'

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200)
    return () => clearTimeout(h)
  }, [q])
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length > 1,
  })

  const href = (kind: string, id: string) =>
    kind === 'page'
      ? { to: '/pages/$pageId' as const, params: { pageId: id } }
      : kind === 'calculator'
        ? { to: '/calculators/$calcId' as const, params: { calcId: id } }
        : { to: '/files' as const }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto mt-[10vh] w-[min(640px,calc(100%-32px))] rounded-[16px] border border-line bg-surface p-0 backdrop:bg-black/30"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <SearchIcon className="text-muted" />
        <label htmlFor="global-search" className="sr-only">
          {t('nav.search')}
        </label>
        <input
          id="global-search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('nav.search')}
          className="h-14 flex-1 border-0 bg-transparent text-[17px] outline-none"
        />
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-line-soft"
        >
          <CloseIcon />
        </button>
      </div>
      <ul className="m-0 max-h-[60vh] list-none overflow-y-auto p-2">
        {isFetching && <li className="p-3 text-sm text-muted">{t('common.loading')}</li>}
        {data?.map((h) => (
          <li key={`${h.kind}-${h.id}`}>
            <Link
              {...href(h.kind, h.id)}
              onClick={onClose}
              className="flex flex-col gap-0.5 rounded-[10px] px-3 py-2.5 text-ink no-underline hover:bg-bg"
            >
              <span className="flex items-center gap-2 font-semibold">
                <span className="rounded bg-line-soft px-1.5 font-mono text-[11px] uppercase text-muted">
                  {h.kind}
                </span>
                {h.title}
              </span>
              {h.snippet && <span className="line-clamp-2 text-sm text-muted">{h.snippet}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </dialog>
  )
}
