import type { AiCitation } from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'

/** Beside the chat: which courses to search, the sources of the last answer, and your recent sessions. */
export function PortalSidebar({
  courseIds,
  onCourseIds,
  used,
  threadId,
  onNewSession,
}: {
  courseIds: string[]
  onCourseIds: (ids: string[]) => void
  /** The sources of the last answer. */
  used: AiCitation[]
  threadId: string | undefined
  onNewSession: () => void
}) {
  const { t } = useTranslation()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const threads = useQuery({ queryKey: ['ai-threads'], queryFn: api.ai.threads })
  return (
    <aside className="flex min-w-0 flex-[1_1_280px] flex-col gap-5">
      <section
        aria-labelledby="h-src"
        className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface p-5"
      >
        <h2 id="h-src" className="m-0 mb-2 text-base font-bold">
          {t('ai.sources')}
        </h2>
        <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="h-[18px] w-[18px] accent-ai"
            checked={courseIds.length === 0}
            onChange={() => onCourseIds([])}
          />
          {t('ai.allCourses')}
        </label>
        {courses.data?.map((c) => (
          <label key={c.id} className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="h-[18px] w-[18px] accent-ai"
              checked={courseIds.includes(c.id)}
              onChange={(e) =>
                onCourseIds(e.target.checked ? [...courseIds, c.id] : courseIds.filter((x) => x !== c.id))
              }
            />
            {c.name}
          </label>
        ))}
      </section>

      {used.length > 0 && (
        <section
          aria-labelledby="h-used"
          className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-5"
        >
          <h2 id="h-used" className="m-0 text-base font-bold">
            {t('ai.used')}
          </h2>
          {used.map((c) => (
            <span key={c.sourceId} className="rounded-[10px] bg-bg px-3 py-2.5 text-sm font-semibold">
              {c.title}
            </span>
          ))}
        </section>
      )}

      <section
        aria-labelledby="h-recent"
        className="flex flex-col gap-1 rounded-[14px] bg-inverse p-5 text-inverse-ink"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 id="h-recent" className="m-0 text-base font-bold">
            {t('ai.recent')}
          </h2>
          <button
            type="button"
            className="min-h-10 cursor-pointer text-sm font-semibold text-ai-on-dark"
            onClick={onNewSession}
          >
            + {t('ai.newSession')}
          </button>
        </div>
        {threads.data?.map((th) => (
          <Link
            key={th.id}
            to="/ai"
            search={{ thread: th.id }}
            className={`flex min-h-11 items-center truncate rounded-[9px] px-3 text-sm text-inverse-ink no-underline hover:bg-inverse-2 hover:text-inverse-ink ${th.id === threadId ? 'bg-inverse-2 font-semibold' : ''}`}
          >
            {th.title}
          </Link>
        ))}
      </section>
    </aside>
  )
}
