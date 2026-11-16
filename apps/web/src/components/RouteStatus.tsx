import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePageTitle } from './feedback'
import { btn } from './ui'

/**
 * A thin bar at the top while the next screen loads (its code is fetched on demand). Shown only after a moment, so
 * quick changes do not flicker.
 */
export function RouteProgress() {
  const pending = useRouterState({ select: (s) => s.status === 'pending' })
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!pending) return setShown(false)
    const timer = setTimeout(() => setShown(true), 150)
    return () => clearTimeout(timer)
  }, [pending])
  if (!shown) return null
  return (
    // Visual only: the next screen announces itself when it arrives.
    <div aria-hidden="true" className="fixed inset-x-0 top-0 z-50 h-[3px] overflow-hidden bg-accent-soft">
      <div className="nc-progress h-full w-2/5 bg-accent" />
    </div>
  )
}

function Screen({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  usePageTitle(title)
  return (
    <div className="flex min-h-[60vh] flex-col items-start justify-center gap-4 px-6 py-16 md:px-12">
      <h1 className="m-0 text-[30px] font-extrabold tracking-[-0.02em]">{title}</h1>
      <p className="m-0 max-w-[560px] text-base text-ink-2">{body}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

/** Shown when a screen fails to render: what happened, and a way out. */
export function ErrorScreen({ error }: { error: unknown }) {
  const { t } = useTranslation()
  return (
    <Screen title={t('status.errorTitle')} body={t('status.errorBody')}>
      <button type="button" className={btn('primary')} onClick={() => window.location.reload()}>
        {t('status.reload')}
      </button>
      <Link to="/" className={btn('secondary')}>
        {t('status.home')}
      </Link>
      {error instanceof Error && error.message && (
        <p className="m-0 w-full font-mono text-xs text-muted">{error.message}</p>
      )}
    </Screen>
  )
}

/** Shown for an address that matches no screen. */
export function NotFoundScreen() {
  const { t } = useTranslation()
  return (
    <Screen title={t('status.notFoundTitle')} body={t('status.notFoundBody')}>
      <Link to="/" className={btn('primary')}>
        {t('status.home')}
      </Link>
    </Screen>
  )
}
