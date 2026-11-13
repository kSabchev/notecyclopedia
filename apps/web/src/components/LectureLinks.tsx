import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { useLectureExtras } from '../lib/lectures'
import { lectureAnchor } from '../lib/links'

/**
 * "Lecture N" of a course: a link to the lecture on the Lectures page when its original is uploaded (that is where
 * lectures are listed), otherwise `fallback`, or the label as plain text.
 */
export function LectureLabel({
  courseId,
  n,
  className,
  fallback,
}: {
  courseId: string
  n: number
  className?: string
  fallback?: ReactNode
}) {
  const { t } = useTranslation()
  const extras = useLectureExtras()
  const label = t('page.lectureNumber', { n })
  if (extras.original(courseId, n))
    return (
      <Link to="/lectures" hash={lectureAnchor(courseId, n)} className={className}>
        {label}
      </Link>
    )
  return fallback ?? <span className={className}>{label}</span>
}

/** "Original: slides.pdf ↗": a lecture's uploaded original, opened in a new tab. */
export function OriginalLink({
  file,
  className,
}: { file: { id: string; name: string }; className?: string }) {
  const { t } = useTranslation()
  return (
    <a href={api.files.url(file.id, true)} target="_blank" rel="noreferrer" className={className}>
      {t('page.original', { name: file.name })} ↗
    </a>
  )
}
