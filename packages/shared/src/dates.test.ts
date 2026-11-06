import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, isCalendarDate } from './dates'

describe('calendar dates', () => {
  it('adds days across months, years and daylight-saving changes', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('counts whole days between dates', () => {
    expect(daysBetween('2026-11-06', '2026-11-20')).toBe(14)
    expect(daysBetween('2026-11-06', '2026-11-06')).toBe(0)
    expect(daysBetween('2026-11-06', '2026-11-01')).toBe(-5)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
  })
  it('accepts only real dates', () => {
    expect(isCalendarDate('2026-11-06')).toBe(true)
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(isCalendarDate('6.11.2026')).toBe(false)
  })
})
