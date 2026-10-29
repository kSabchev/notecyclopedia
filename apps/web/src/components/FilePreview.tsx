import { missionFileKind, parseMissionSpacecraft } from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { ErrorNote, btn } from './ui'

const PREVIEW_LINES = 2000
const TEXT_EXTENSIONS = /\.(txt|md|csv|script|missionplan)$/i

/** Text files shown as plain text in the browser, including GMAT and FreeFlyer mission files. */
export const isTextPreviewable = (name: string) => TEXT_EXTENSIONS.test(name)

/**
 * A read-only view of a text file. GMAT scripts and FreeFlyer mission plans also list their spacecraft
 * with a link to the orbit viewer. Nothing in the file is executed.
 */
export function FilePreview({ file }: { file: { id: string; name: string } }) {
  const { t } = useTranslation()
  const text = useQuery({
    queryKey: ['file-text', file.id],
    queryFn: async () => {
      const res = await fetch(api.files.url(file.id, true))
      if (!res.ok) throw new Error(t('files.previewFailed'))
      return res.text()
    },
  })
  const kind = missionFileKind(file.name)

  if (text.error) return <ErrorNote error={text.error} />
  if (!text.data) return <p className="m-0 text-sm text-muted">{t('common.loading')}</p>
  const lines = text.data.split(/\r?\n/)
  const spacecraft = kind ? parseMissionSpacecraft(text.data, kind) : []

  return (
    <div className="flex flex-col gap-3">
      {kind && (
        <section className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-4">
          <h3 className="m-0 text-sm font-bold">{t('files.spacecraft')}</h3>
          {spacecraft.length === 0 && <p className="m-0 text-sm text-muted">{t('files.noSpacecraft')}</p>}
          {spacecraft.map((sc) => {
            const { a, e, i, raan, argp, nu } = sc.elements
            const round = (n: number, d: number) => Number(n.toFixed(d))
            return (
              <div key={sc.name} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="font-semibold">{sc.name}</span>
                <span className="font-mono text-[13px] text-muted">
                  a {round(a, 1)} km · e {round(e, 4)} · i {round(i, 2)}°
                  {sc.from === 'cartesian' && ` · ${t('files.fromCartesian')}`}
                </span>
                <span className="flex-1" />
                <Link
                  to="/orbit"
                  search={{
                    body: sc.body,
                    a: round(a, 3),
                    e: round(e, 6),
                    i: round(i, 4),
                    raan: round(raan, 4),
                    argp: round(argp, 4),
                    nu: round(nu, 4),
                  }}
                  className={btn('secondary', 'sm')}
                >
                  {t('files.openInViewer')}
                </Link>
              </div>
            )
          })}
        </section>
      )}
      <pre className="m-0 max-h-[60vh] overflow-auto rounded-[10px] border border-line bg-surface-2 py-3 font-mono text-[13px] leading-relaxed">
        {lines.slice(0, PREVIEW_LINES).map((line, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lines of a static file
          <div key={n} className="flex">
            <span aria-hidden="true" className="w-12 shrink-0 select-none pr-3 text-right text-muted">
              {n + 1}
            </span>
            <code className="whitespace-pre pr-4">{line}</code>
          </div>
        ))}
      </pre>
      {lines.length > PREVIEW_LINES && (
        <p className="m-0 text-sm text-muted">{t('files.previewTruncated', { n: PREVIEW_LINES })}</p>
      )}
    </div>
  )
}
