import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from './api'

/**
 * What hangs off a lecture number besides its pages: the uploaded original (slides or PDF) and the calculators
 * tagged with it. Shared by Lectures, the Wiki's lecture view and the page view.
 */
export function useLectureExtras() {
  const originals = useQuery({
    queryKey: ['files', 'originals'],
    queryFn: () => api.files.list({ originals: '1' }),
  })
  const calculators = useQuery({ queryKey: ['calculators'], queryFn: api.calculators.list })
  return {
    isPending: originals.isPending || calculators.isPending,
    originalsOf: (courseId: string) => (originals.data ?? []).filter((f) => f.courseId === courseId),
    original: (courseId: string, n: number | null) =>
      n === null ? undefined : originals.data?.find((f) => f.courseId === courseId && f.lectureNumber === n),
    calculatorsOf: (courseId: string, n?: number | null) =>
      (calculators.data ?? []).filter(
        (c) =>
          c.courseId === courseId && c.lectureNumber !== null && (n === undefined || c.lectureNumber === n),
      ),
  }
}

export type CourseOption = { id: string; name: string }

/**
 * Which lectures of a course already have an original, and whether `n` is one of them (`except`: the file being
 * marked). Lecture numbers are per course: every course has its own lecture 1, 2, 3…
 */
export function useTaken(course: CourseOption | undefined, n: number | null, except?: string) {
  const { t } = useTranslation()
  const extras = useLectureExtras()
  const originals = course ? extras.originalsOf(course.id).filter((f) => f.id !== except) : []
  const holder = n === null ? undefined : originals.find((f) => f.lectureNumber === n)
  const note = !course
    ? null
    : holder
      ? t('files.takenBy', { n, course: course.name, name: holder.name })
      : originals.length
        ? t('files.taken', { course: course.name, list: originals.map((f) => f.lectureNumber).join(', ') })
        : t('files.noneTaken', { course: course.name })
  return { taken: !!holder, note }
}
