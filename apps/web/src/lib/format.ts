import { useTranslation } from 'react-i18next'
import i18n from '../i18n'

/** An estimated cost in US dollars, e.g. "$0.0031". */
export const formatCost = (usd: number) => `$${usd.toFixed(usd < 0.01 ? 4 : 3)}`

export function timeAgo(iso: string): string {
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  const s = (new Date(iso).getTime() - Date.now()) / 1000
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ]
  let v = s
  for (const [n, unit] of steps) {
    if (Math.abs(v) < n) return rtf.format(Math.round(v), unit)
    v /= n
  }
  return ''
}

export function fileBadge(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase() ?? 'FILE'
  return ext.length > 4 ? 'FILE' : ext
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Today in the browser's time zone, as YYYY-MM-DD. */
export const todayLocal = () => new Date().toLocaleDateString('en-CA')

/**
 * A day (YYYY-MM-DD) for display in the interface language: "Tuesday, 12 November", or with `short` "Tue 12 Nov".
 * Read at noon UTC, so the day is the same in every time zone.
 */
export function useDayLabel(style: 'long' | 'short' = 'long') {
  const { i18n } = useTranslation()
  return (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, {
      weekday: style,
      day: 'numeric',
      month: style,
      timeZone: 'UTC',
    })
}
