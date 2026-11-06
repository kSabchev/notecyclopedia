import { describe, expect, it } from 'vitest'
import { catchUp, fitBeforeExam, spreadTasks, studyDates } from './study-plan'
import type { ExamPlanDay } from './types'

const task = (id: string, done = false) => ({ id, pageId: null, pageTitle: null, focus: id, done })
const shape = (days: ExamPlanDay[] | null) => days?.map((d) => [d.date, d.items.map((i) => i.id)])

describe('study dates', () => {
  it('runs from a day up to the day before the exam, on the chosen weekdays', () => {
    // 2026-11-07 is a Saturday.
    expect(studyDates('2026-11-07', '2026-11-11')).toEqual([
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
    ])
    expect(studyDates('2026-11-07', '2026-11-11', [1, 2, 3, 4, 5])).toEqual(['2026-11-09', '2026-11-10'])
    expect(studyDates('2026-11-11', '2026-11-11')).toEqual([])
  })
})

describe('spreading tasks', () => {
  it('fills the least busy days first, the earliest on a tie, and drops empty days', () => {
    const days = [
      { date: '2026-11-09', items: [task('a'), task('b')] },
      { date: '2026-11-10', items: [task('c', true)] },
    ]
    expect(
      shape(spreadTasks(days, [task('x'), task('y'), task('z')], ['2026-11-09', '2026-11-10', '2026-11-11'])),
    ).toEqual([
      ['2026-11-09', ['a', 'b']],
      // A done task does not count towards a day's load.
      ['2026-11-10', ['c', 'x', 'z']],
      ['2026-11-11', ['y']],
    ])
  })
})

describe('catching up', () => {
  const plan = [
    { date: '2026-11-05', items: [task('read', true), task('examples')] },
    { date: '2026-11-06', items: [task('formulas')] },
    { date: '2026-11-07', items: [task('today')] },
    { date: '2026-11-09', items: [task('later')] },
  ]
  it('moves unfinished past tasks onto the days left; done ones stay', () => {
    expect(shape(catchUp(plan, '2026-11-07', '2026-11-10'))).toEqual([
      ['2026-11-05', ['read']],
      ['2026-11-07', ['today', 'formulas']],
      ['2026-11-08', ['examples']],
      ['2026-11-09', ['later']],
    ])
  })
  it('keeps to the study weekdays, and gives up when no day is left', () => {
    // Weekdays only: Saturday the 7th and Sunday the 8th are skipped.
    expect(shape(catchUp(plan, '2026-11-07', '2026-11-11', [1, 2, 3, 4, 5]))).toEqual([
      ['2026-11-05', ['read']],
      ['2026-11-07', ['today']],
      ['2026-11-09', ['later', 'formulas']],
      ['2026-11-10', ['examples']],
    ])
    expect(catchUp(plan, '2026-11-10', '2026-11-10')).toBeNull()
  })
})

describe('moving the exam earlier', () => {
  it('moves tasks on or after the new exam day onto the days before it', () => {
    const plan = [
      { date: '2026-11-07', items: [task('a')] },
      { date: '2026-11-09', items: [task('b')] },
      { date: '2026-11-10', items: [task('c'), task('d')] },
    ]
    expect(shape(fitBeforeExam(plan, '2026-11-07', '2026-11-09'))).toEqual([
      ['2026-11-07', ['a', 'c']],
      ['2026-11-08', ['b', 'd']],
    ])
    expect(fitBeforeExam(plan, '2026-11-07', '2026-11-11')).toBe(plan)
    expect(fitBeforeExam(plan, '2026-11-09', '2026-11-09')).toBeNull()
  })
})
