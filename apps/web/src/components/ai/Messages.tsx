import type { AiAttachment, AiCitation } from '@nc/shared'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { attachmentUrl } from '../../lib/image'

/** A question as sent: its photos, then its text. */
export function UserMessage({ content, attachments }: { content: string; attachments: AiAttachment[] }) {
  const { t } = useTranslation()
  return (
    <div className="flex max-w-[620px] flex-col gap-3 self-end whitespace-pre-wrap rounded-[14px_14px_4px_14px] bg-inverse px-5 py-4 text-base text-inverse-ink">
      {attachments?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <img
              // biome-ignore lint/suspicious/noArrayIndexKey: photos of a sent message never change
              key={i}
              src={attachmentUrl(a)}
              alt={t('ai.photo', { n: i + 1 })}
              className="max-h-60 max-w-full rounded-lg"
            />
          ))}
        </div>
      )}
      {content}
    </div>
  )
}

/** The sources an answer used, numbered as it cites them: pages open in the app, uploads in a new tab. */
export function Citations({ citations }: { citations: AiCitation[] }) {
  if (!citations.length) return null
  return (
    <div className="flex flex-wrap gap-2 border-t border-line-soft pt-3">
      {citations.map((c, i) =>
        c.sourceType === 'page' ? (
          <Link
            key={c.sourceId}
            to="/pages/$pageId"
            params={{ pageId: c.sourceId }}
            className="rounded-md bg-accent-soft px-2 py-0.5 text-[13px] font-semibold no-underline"
          >
            [{i + 1}] {c.title}
          </Link>
        ) : (
          <a
            key={c.sourceId}
            href={api.files.url(c.sourceId, true)}
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-line-soft px-2 py-0.5 text-[13px] font-semibold text-ink no-underline"
          >
            [{i + 1}] {c.title}
          </a>
        ),
      )}
    </div>
  )
}
