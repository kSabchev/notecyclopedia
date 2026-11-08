/** Page types, in the order their sections appear in a course. `seminar` pages are example problems. */
export const PAGE_TYPES = ['lecture', 'seminar', 'theory', 'note', 'source'] as const
export type PageType = (typeof PAGE_TYPES)[number]

export interface PageSection<T> {
  type: PageType
  pages: T[]
}

/** Lecture number order: numbered pages first, ascending; the manual order is kept otherwise (stable sort). */
const byLecture = (a: { lectureNumber: number | null }, b: { lectureNumber: number | null }) =>
  (a.lectureNumber ?? Number.POSITIVE_INFINITY) - (b.lectureNumber ?? Number.POSITIVE_INFINITY)

/**
 * A course's pages, given in their manual order, as sections by type. Lectures and example problems are
 * ordered by lecture number (an example problem's number is the lecture it practises); the other sections
 * keep the manual order. Empty sections are left out.
 */
export function pageSections<T extends { type: PageType; lectureNumber: number | null }>(
  pages: T[],
): PageSection<T>[] {
  return PAGE_TYPES.map((type) => {
    const ofType = pages.filter((p) => p.type === type)
    return { type, pages: type === 'lecture' || type === 'seminar' ? ofType.sort(byLecture) : ofType }
  }).filter((s) => s.pages.length > 0)
}

/** How many example problems practise each lecture number. */
export function problemsPerLecture(pages: { type: PageType; lectureNumber: number | null }[]) {
  const counts = new Map<number, number>()
  for (const p of pages)
    if (p.type === 'seminar' && p.lectureNumber !== null)
      counts.set(p.lectureNumber, (counts.get(p.lectureNumber) ?? 0) + 1)
  return counts
}

/**
 * The manual order after moving a page within its section, as the full list of page ids: the sections'
 * current order with the page moved. Moves outside the section are ignored.
 */
export function moveWithinSection<T extends { id: string; type: PageType; lectureNumber: number | null }>(
  pages: T[],
  pageId: string,
  to: number,
): string[] | null {
  const sections = pageSections(pages)
  const section = sections.find((s) => s.pages.some((p) => p.id === pageId))
  if (!section) return null
  const from = section.pages.findIndex((p) => p.id === pageId)
  if (to < 0 || to >= section.pages.length || to === from) return null
  const [moved] = section.pages.splice(from, 1)
  section.pages.splice(to, 0, moved as T)
  return sections.flatMap((s) => s.pages.map((p) => p.id))
}

/** Within a lecture: the lecture itself, then its theory, notes and sources, then the example problems. */
const LECTURE_ORDER: PageType[] = ['lecture', 'theory', 'note', 'source', 'seminar']

export interface LectureGroup<T> {
  /** null: the pages not tied to a lecture. */
  lectureNumber: number | null
  pages: T[]
}

/**
 * A course's pages, given in their manual order, grouped by lecture number: ascending, with the pages not tied
 * to a lecture last. Within a group the lecture comes first and its example problems last; the manual order is
 * kept otherwise.
 */
export function lectureGroups<T extends { type: PageType; lectureNumber: number | null }>(
  pages: T[],
): LectureGroup<T>[] {
  const groups = new Map<number | null, T[]>()
  for (const p of pages) groups.set(p.lectureNumber, [...(groups.get(p.lectureNumber) ?? []), p])
  return [...groups]
    .map(([lectureNumber, ps]) => ({
      lectureNumber,
      pages: ps.sort((a, b) => LECTURE_ORDER.indexOf(a.type) - LECTURE_ORDER.indexOf(b.type)),
    }))
    .sort(byLecture)
}
