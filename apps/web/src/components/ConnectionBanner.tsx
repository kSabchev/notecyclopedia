import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { reportReachable, useConnection } from '../lib/connection'
import { useToast } from './FeedbackProvider'
import { Spinner } from './feedback'

/** How often to check whether an unreachable server is back. */
const RETRY_MS = 3000

/**
 * A notice while the app cannot reach its server: the browser is offline, or requests do not get through. When the
 * connection is back it says so and reloads what is on screen.
 */
export function ConnectionBanner() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const connection = useConnection()
  const previous = useRef(connection)

  // While requests fail but the browser is online, keep checking the server.
  useEffect(() => {
    if (connection !== 'unreachable') return
    const timer = setInterval(() => {
      fetch('/api/health', { cache: 'no-store' })
        .then((res) => res.ok && reportReachable(true))
        .catch(() => {})
    }, RETRY_MS)
    return () => clearInterval(timer)
  }, [connection])

  useEffect(() => {
    if (previous.current !== 'online' && connection === 'online') {
      toast(t('connection.back'))
      qc.invalidateQueries({ refetchType: 'active' })
    }
    previous.current = connection
  }, [connection, qc, t, toast])

  if (connection === 'online') return null
  return (
    <div
      role="status"
      className="nc-fade fixed left-1/2 top-3 z-50 flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-center gap-2.5 rounded-[12px] border border-note-line bg-note px-4 py-2.5 text-sm text-ink shadow-lg"
    >
      {connection === 'unreachable' && <Spinner />}
      <span>{t(connection === 'offline' ? 'connection.offline' : 'connection.unreachable')}</span>
    </div>
  )
}
