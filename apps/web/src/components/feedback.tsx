import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/** A small spinning ring, sized to the text around it; for buttons and inline waits. */
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`h-[1em] w-[1em] shrink-0 animate-spin motion-reduce:animate-none ${className}`}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** A grey placeholder bar, the shape of content still loading. */
export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-line-soft motion-reduce:animate-none ${className}`}
    />
  )
}

/** Placeholders for a list: `rows` cards of a title line and a shorter line, announced once as loading. */
export function SkeletonList({ rows = 3, className = '' }: { rows?: number; className?: string }) {
  const { t } = useTranslation()
  return (
    <div role="status" aria-busy="true" className={`flex flex-col gap-3 ${className}`}>
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
        <div key={i} className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-4">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  )
}

/** Placeholders for a whole page of text: a title, then paragraphs. */
export function SkeletonPage() {
  const { t } = useTranslation()
  return (
    <div role="status" aria-busy="true" className="flex max-w-[760px] flex-col gap-4 px-6 pt-8 md:px-12">
      <span className="sr-only">{t('common.loading')}</span>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-10 w-3/5" />
      <Skeleton className="h-3 w-40" />
      <div className="mt-6 flex flex-col gap-3">
        {['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-3/4'].map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
          <Skeleton key={i} className={`h-4 ${w}`} />
        ))}
      </div>
    </div>
  )
}

/** Sets the browser tab's title: "<title> · Notecyclopedia", or just the app name. */
export function usePageTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · Notecyclopedia` : 'Notecyclopedia'
  }, [title])
}

/** Placeholders for a grid of cards (pinned formulas, recent pages). */
export function SkeletonCards({ count = 3, className = 'h-28' }: { count?: number; className?: string }) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-busy="true"
      className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3"
    >
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
        <Skeleton key={i} className={`rounded-[12px] ${className}`} />
      ))}
    </div>
  )
}

/**
 * While an AI answer has not started: "Thinking…" with fading dots, or what Claude is doing at the moment (looking up
 * calculators, running one).
 */
export function Thinking({ activity }: { activity?: string | null }) {
  const { t } = useTranslation()
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      {activity ? (
        <>
          <Spinner />
          {activity}
        </>
      ) : (
        <span className="nc-dots">
          {t('common.thinking')}
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      )}
    </span>
  )
}
