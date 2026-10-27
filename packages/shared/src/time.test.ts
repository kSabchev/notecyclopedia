import { describe, expect, it } from 'vitest'
import { localDate } from './time'

describe('localDate', () => {
  it('starts the day at local midnight in EET (UTC+2)', () => {
    expect(localDate(new Date('2026-01-14T21:59:00Z'))).toBe('2026-01-14')
    expect(localDate(new Date('2026-01-14T22:00:00Z'))).toBe('2026-01-15')
  })
  it('follows summer time (UTC+3)', () => {
    expect(localDate(new Date('2026-07-14T20:59:00Z'))).toBe('2026-07-14')
    expect(localDate(new Date('2026-07-14T21:00:00Z'))).toBe('2026-07-15')
  })
  it('accepts another zone', () => {
    expect(localDate(new Date('2026-01-15T03:00:00Z'), 'America/New_York')).toBe('2026-01-14')
  })
})
