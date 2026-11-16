import { useSyncExternalStore } from 'react'

/**
 * Whether the app can talk to its server: `offline` when the browser has no network, `unreachable` when a request
 * failed to get through (the server is down, or the network drops requests), else `online`. API requests report each
 * attempt with `reportReachable`.
 */
export type Connection = 'online' | 'offline' | 'unreachable'

let reachable = true
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}

/** Called by the API client after each request: false when it could not reach the server at all. */
export function reportReachable(ok: boolean) {
  if (reachable === ok) return
  reachable = ok
  notify()
}

// Requests that failed while the browser was offline say nothing about the server: start afresh when it is back.
if (typeof window !== 'undefined') window.addEventListener('online', () => reportReachable(true))

/** A request that failed before any response (not one the user cancelled). */
export const isNetworkFailure = (e: unknown) => e instanceof TypeError

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

const snapshot = (): Connection => (!navigator.onLine ? 'offline' : reachable ? 'online' : 'unreachable')

export function useConnection(): Connection {
  return useSyncExternalStore(subscribe, snapshot, () => 'online')
}
