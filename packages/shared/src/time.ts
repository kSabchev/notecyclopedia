/** Every account uses this zone until users can choose one: Eastern European Time (UTC+2, UTC+3 in summer). */
export const DEFAULT_TIME_ZONE = 'Europe/Sofia'

/** The calendar date (`YYYY-MM-DD`) of `at` in `timeZone`, e.g. the key for a user's daily quiz. */
export function localDate(at: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}
