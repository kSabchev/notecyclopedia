import { describe, expect, it } from 'vitest'
import { importPlanDays, planFileSchema, toPlanFile } from './plan-file'
import type { ExamPlan } from './types'

const plan: ExamPlan = {
  id: 'plan',
  courseId: 'course',
  title: 'Astro final',
  examDate: '2026-12-01',
  studyWeekdays: [1, 2, 3, 4, 5],
  active: true,
  days: [
    {
      date: '2026-11-10',
      items: [
        { id: 'a', pageId: 'p-kepler', pageTitle: 'Kepler orbits', focus: 'Read', done: true },
        {
          id: 'b',
          pageId: null,
          pageTitle: null,
          focus: 'Mock exam',
          done: false,
          lectureNumber: 3,
          calculatorIds: ['calc-mine'],
        },
      ],
    },
    {
      date: '2026-11-09',
      items: [{ id: 'c', pageId: 'p-gone', pageTitle: 'Hohmann  Transfers', focus: 'Examples', done: false }],
    },
  ],
  usage: null,
  createdAt: '',
  updatedAt: '',
}

describe('plan files', () => {
  it('round-trip through the file format, which is checked on import', () => {
    const file = planFileSchema.parse(JSON.parse(JSON.stringify(toPlanFile(plan, 'Astrodynamics'))))
    expect(file.title).toBe('Astro final')
    expect(file.days[0]?.items[0]).toEqual({
      focus: 'Read',
      done: true,
      page: { id: 'p-kepler', title: 'Kepler orbits' },
    })
    expect(() => planFileSchema.parse({ ...file, format: 'something-else' })).toThrow()
  })

  it('keeps a task’s lecture but not its calculators, which are personal', () => {
    const file = toPlanFile(plan)
    expect(file.days[0]?.items[1]).toEqual({ focus: 'Mock exam', done: false, lectureNumber: 3, page: null })
    const { days } = importPlanDays(file, [])
    const mock = days.flatMap((d) => d.items).find((i) => i.focus === 'Mock exam')
    expect(mock?.lectureNumber).toBe(3)
    expect(mock?.calculatorIds).toBeUndefined()
  })

  it('links tasks to the target course by id, then by title; others keep the title without a link', () => {
    const file = toPlanFile(plan)
    const { days, linked, unlinked } = importPlanDays(file, [
      { id: 'other-kepler', title: 'Something else' },
      { id: 'p-kepler', title: 'Kepler orbits' },
      { id: 'q-hohmann', title: 'hohmann transfers' },
    ])
    expect(days.map((d) => d.date)).toEqual(['2026-11-09', '2026-11-10'])
    expect(days.map((d) => d.items.map((i) => [i.pageId, i.pageTitle, i.done]))).toEqual([
      [['q-hohmann', 'hohmann transfers', false]],
      [
        ['p-kepler', 'Kepler orbits', false],
        [null, null, false],
      ],
    ])
    expect([linked, unlinked]).toEqual([2, 0])
    // Every task gets a new id.
    expect(days.flatMap((d) => d.items.map((i) => i.id))).not.toContain('a')
  })

  it('keeps progress only when asked, and reports pages it could not find', () => {
    const { days, linked, unlinked } = importPlanDays(toPlanFile(plan), [], true)
    expect(days[1]?.items[0]).toEqual(
      expect.objectContaining({ pageId: null, pageTitle: 'Kepler orbits', done: true }),
    )
    expect([linked, unlinked]).toEqual([0, 2])
  })
})
