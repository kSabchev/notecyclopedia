import { type DiffLine, diffLines, docBlocks } from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { ErrorNote } from './ui'

/** Unchanged blocks kept around each change; longer unchanged runs collapse into a count. */
const CONTEXT = 1

type Row = DiffLine | { op: 'skip'; count: number }

function collapse(lines: DiffLine[]): Row[] {
  const rows: Row[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i]?.op !== 'same') {
      rows.push(lines[i++] as DiffLine)
      continue
    }
    let end = i
    while (lines[end]?.op === 'same') end++
    const keepStart = i === 0 ? 0 : CONTEXT
    const keepEnd = end === lines.length ? 0 : CONTEXT
    if (end - i > keepStart + keepEnd + 1) {
      rows.push(...lines.slice(i, i + keepStart))
      rows.push({ op: 'skip', count: end - i - keepStart - keepEnd })
      rows.push(...lines.slice(end - keepEnd, end))
    } else rows.push(...lines.slice(i, end))
    i = end
  }
  return rows
}

/** What revision `rev` changed compared with the revision before it. */
export function RevisionChanges({ pageId, rev }: { pageId: string; rev: number }) {
  const { t } = useTranslation()
  const current = useQuery({
    queryKey: ['revision', pageId, rev],
    queryFn: () => api.pages.revision(pageId, rev),
  })
  const previous = useQuery({
    queryKey: ['revision', pageId, rev - 1],
    queryFn: () => api.pages.revision(pageId, rev - 1),
    enabled: rev > 1,
  })
  if (current.error || previous.error) return <ErrorNote error={current.error ?? previous.error} />
  if (!current.data || (rev > 1 && !previous.data))
    return <p className="m-0 text-sm text-muted">{t('common.loading')}</p>

  const before = previous.data
  const lines = diffLines(docBlocks(before?.content), docBlocks(current.data.content))
  const titleChanged = before && before.title !== current.data.title
  if (!titleChanged && lines.every((l) => l.op === 'same'))
    return <p className="m-0 text-sm text-muted">{t('page.noChanges')}</p>

  const mark = { add: '+', remove: '−', same: ' ' }
  const style = {
    add: 'bg-ok-soft text-ink',
    remove: 'bg-danger-soft text-ink line-through decoration-danger/60',
    same: 'text-muted',
  }
  return (
    <div className="flex flex-col gap-1 font-mono text-[13px]">
      {titleChanged && (
        <div className="mb-2 flex flex-col gap-1">
          <span className="font-sans text-xs font-semibold uppercase tracking-wider text-muted">
            {t('page.titleChange')}
          </span>
          <span className={`rounded-md px-2 py-1 ${style.remove}`}>− {before.title}</span>
          <span className={`rounded-md px-2 py-1 ${style.add}`}>+ {current.data.title}</span>
        </div>
      )}
      {collapse(lines).map((row, i) =>
        row.op === 'skip' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are derived and never reordered
          <span key={i} className="px-2 py-0.5 font-sans text-xs text-muted">
            ⋯ {t('page.unchangedBlocks', { count: row.count })}
          </span>
        ) : (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are derived and never reordered
            key={i}
            className={`whitespace-pre-wrap break-words rounded-md px-2 py-1 ${style[row.op]}`}
          >
            {mark[row.op]} {row.text}
          </span>
        ),
      )}
    </div>
  )
}
