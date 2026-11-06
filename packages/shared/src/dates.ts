/** Calendar dates as `YYYY-MM-DD`, computed in UTC so time zones and daylight saving never shift a day. */

const parse = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y as number, (m as number) - 1, d as number)
}
const DAY_MS = 86_400_000

export const isCalendarDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(parse(value)).toISOString().slice(0, 10) === value

/** The date `days` after `date` (before it when negative). */
export function addDays(date: string, days: number): string {
  return new Date(parse(date) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`: 1 from a day to the next, negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to) - parse(from)) / DAY_MS)
}
