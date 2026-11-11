import type { ExamPlanItem } from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/** The element id of a lecture's card on the Lectures page, for links that jump to it. */
export const lectureAnchor = (courseId: string, n: number) => `lecture-${courseId}-${n}`

/** A course's section on the Lectures page. */
export const courseAnchor = (courseId: string) => `lec-${courseId}`

export interface PlanTask {
  planId: string
  planTitle: string
  date: string
  item: ExamPlanItem
}

/** The lecture a task is about: its own, else its page's. */
export const taskLecture = (item: ExamPlanItem, pageLecture: (pageId: string) => number | null | undefined) =>
  item.lectureNumber ?? (item.pageId ? (pageLecture(item.pageId) ?? null) : null)

/**
 * Tasks of your active exam plans that point at a page, a lecture of a course or a calculator, open ones first, then
 * by day. `pageLecture` gives a page's lecture number, for tasks that link a page but no lecture.
 */
export function usePlanTasks() {
  const plans = useQuery({ queryKey: ['study', 'plans'], queryFn: api.study.plans })
  return (
    match: {
      courseId?: string | null
      pageId?: string
      lectureNumber?: number | null
      calculatorId?: string
    },
    pageLecture: (pageId: string) => number | null | undefined = () => null,
  ): PlanTask[] =>
    (plans.data ?? [])
      .filter((p) => p.active)
      .flatMap((p) =>
        p.days.flatMap((d) =>
          d.items
            .filter(
              (item) =>
                (match.pageId !== undefined && item.pageId === match.pageId) ||
                (match.calculatorId !== undefined &&
                  (item.calculatorIds ?? []).includes(match.calculatorId)) ||
                (match.courseId === p.courseId &&
                  match.lectureNumber != null &&
                  taskLecture(item, pageLecture) === match.lectureNumber),
            )
            .map((item) => ({ planId: p.id, planTitle: p.title, date: d.date, item })),
        ),
      )
      .sort((a, b) => Number(a.item.done) - Number(b.item.done) || a.date.localeCompare(b.date))
}
