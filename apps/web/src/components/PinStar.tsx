import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type KeyboardEvent, type MouseEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'

/** Your pinned formulas, shared by the home page, the formula list, the reader and the formula card. */
export function usePinnedFormulas() {
  return useQuery({ queryKey: ['formulas', 'pinned'], queryFn: () => api.formulas(true) })
}

/** Whether you pinned the formula block `nodeId` of page `pageId`. */
export function useIsPinned(pageId: string, nodeId: string | null) {
  const pinned = usePinnedFormulas()
  return !!nodeId && !!pinned.data?.some((f) => f.pageId === pageId && f.nodeId === nodeId)
}

/**
 * ☆ / ★: pin a formula to your home page, or unpin it. Pins are your own (not part of the page), so anyone who can
 * read the page can pin. Clicks stay on the star: inside a formula block they do not open its card.
 */
export function PinStar({
  pageId,
  nodeId,
  pinned,
}: { pageId: string; nodeId: string | null; pinned: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [on, setOn] = useState(pinned)
  useEffect(() => setOn(pinned), [pinned])
  const save = useMutation({
    mutationFn: (next: boolean) => api.pinFormula(pageId, nodeId ?? '', next),
    onMutate: (next) => setOn(next),
    onError: () => setOn(pinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['formulas'] }),
  })
  if (!nodeId) return null
  const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation()
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? t('formulas.unpin') : t('formulas.pin')}
      title={on ? t('formulas.unpin') : t('formulas.pin')}
      disabled={save.isPending}
      onKeyDown={stop}
      onClick={(e) => {
        stop(e)
        save.mutate(!on)
      }}
      className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-xl leading-none hover:bg-line-soft ${on ? 'text-accent' : 'text-muted'}`}
    >
      {on ? '★' : '☆'}
    </button>
  )
}

/** The star in front of a formula while reading a page. */
export function FormulaPin({ pageId, nodeId }: { pageId: string; nodeId: string | null }) {
  return <PinStar pageId={pageId} nodeId={nodeId} pinned={useIsPinned(pageId, nodeId)} />
}
