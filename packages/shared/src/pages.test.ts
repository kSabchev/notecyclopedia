import { describe, expect, it } from 'vitest'
import { type PageType, lectureGroups, moveWithinSection, pageSections, problemsPerLecture } from './pages'

const page = (id: string, type: PageType, lectureNumber: number | null = null) => ({
  id,
  type,
  lectureNumber,
})

// In manual order, as the server returns a course's pages.
const course = [
  page('notes', 'note'),
  page('l2', 'lecture', 2),
  page('p1b', 'seminar', 1),
  page('hub', 'theory'),
  page('l1', 'lecture', 1),
  page('extra', 'lecture'),
  page('p-free', 'seminar'),
  page('p1a', 'seminar', 1),
  page('p2', 'seminar', 2),
]
const ids = (pages: { id: string }[]) => pages.map((p) => p.id)

describe('pageSections', () => {
  it('orders sections by type and lectures and problems by lecture number', () => {
    const sections = pageSections(course)
    expect(sections.map((s) => s.type)).toEqual(['lecture', 'seminar', 'theory', 'note'])
    expect(ids(sections[0]?.pages ?? [])).toEqual(['l1', 'l2', 'extra'])
    // Problems of the same lecture keep their manual order; unlinked problems come last.
    expect(ids(sections[1]?.pages ?? [])).toEqual(['p1b', 'p1a', 'p2', 'p-free'])
  })

  it('counts the example problems of each lecture', () => {
    expect(problemsPerLecture(course)).toEqual(
      new Map([
        [1, 2],
        [2, 1],
      ]),
    )
  })
})

describe('moveWithinSection', () => {
  it('moves a page within its section and returns the full manual order', () => {
    expect(moveWithinSection(course, 'p1a', 0)).toEqual([
      'l1',
      'l2',
      'extra',
      'p1a',
      'p1b',
      'p2',
      'p-free',
      'hub',
      'notes',
    ])
  })

  it('ignores moves past the ends of the section', () => {
    expect(moveWithinSection(course, 'hub', 1)).toBeNull()
    expect(moveWithinSection(course, 'l1', -1)).toBeNull()
    expect(moveWithinSection(course, 'missing', 0)).toBeNull()
  })
})

describe('lectureGroups', () => {
  it('groups by lecture in order, the lecture first and its problems last, unnumbered pages at the end', () => {
    const groups = lectureGroups([...course, page('n1', 'note', 1), page('src2', 'source', 2)])
    expect(groups.map((g) => [g.lectureNumber, g.pages.map((p) => p.id)])).toEqual([
      [1, ['l1', 'n1', 'p1b', 'p1a']],
      [2, ['l2', 'src2', 'p2']],
      [null, ['extra', 'hub', 'notes', 'p-free']],
    ])
  })
})
