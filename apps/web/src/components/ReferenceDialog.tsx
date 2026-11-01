import { pageLink } from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { inputCls } from './ui'

/**
 * Pick a page, or a term (a heading on a page), to reference. `onPick` gets the in-app link and the name to
 * show; terms are listed first because a reference usually points at a section.
 */
export function ReferenceDialog({
  currentPageId,
  onPick,
  onClose,
}: {
  currentPageId?: string
  onPick: (reference: { href: string; label: string }) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDialogElement>(null)
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200)
    return () => clearTimeout(h)
  }, [q])
  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length > 1,
  })
  const hits = (results.data ?? []).filter(
    (h) => h.kind === 'term' || (h.kind === 'page' && h.id !== currentPageId),
  )

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="ref-title"
      className="m-auto mt-[12vh] w-[min(560px,calc(100%-32px))] rounded-[16px] border border-line bg-surface p-0 backdrop:bg-black/30"
    >
      <div className="flex flex-col gap-3 border-b border-line p-4">
        <h2 id="ref-title" className="m-0 text-base font-bold">
          {t('reference.title')}
        </h2>
        <label htmlFor="ref-search" className="sr-only">
          {t('reference.search')}
        </label>
        <input
          id="ref-search"
          autoFocus
          className={inputCls}
          placeholder={t('reference.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <p className="m-0 text-xs text-muted">{t('reference.hint')}</p>
      </div>
      <ul className="m-0 max-h-[50vh] list-none overflow-y-auto p-2">
        {debounced.length > 1 && !results.isFetching && hits.length === 0 && (
          <li className="p-3 text-sm text-muted">{t('reference.none')}</li>
        )}
        {hits.map((h) => (
          <li key={`${h.kind}-${h.id}-${h.anchor ?? ''}`}>
            <button
              type="button"
              onClick={() => onPick({ href: pageLink(h.id, h.anchor), label: h.title })}
              className="flex w-full cursor-pointer flex-col gap-0.5 rounded-[10px] border-0 bg-transparent px-3 py-2.5 text-left text-ink hover:bg-bg"
            >
              <span className="flex items-center gap-2 font-semibold">
                <span className="rounded bg-line-soft px-1.5 text-[11px] uppercase text-muted">
                  {t(`search.kinds.${h.kind}`)}
                </span>
                {h.title}
              </span>
              {h.kind === 'term' && <span className="text-sm text-muted">{h.snippet}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex justify-end border-t border-line p-3">
        <button type="button" className="cursor-pointer text-sm font-semibold text-accent" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </dialog>
  )
}
