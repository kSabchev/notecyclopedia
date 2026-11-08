import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from '../components/Icons'
import { ErrorNote, SectionHeader, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'

/** Links that come with the app; their descriptions are translated (`links.<key>`). */
const BUILT_IN = [
  { key: 'eyes', title: "NASA's Eyes", url: 'https://science.nasa.gov/eyes/' },
  {
    key: 'copernicus',
    title: 'Copernicus Browser',
    url: 'https://browser.dataspace.copernicus.eu/?zoom=5&lat=50.16282&lng=20.78613&demSource3D=%22MAPZEN%22&cloudCoverage=30&dateMode=SINGLE&panel=layers',
  },
  { key: 'horizons', title: 'JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/' },
  { key: 'celestrak', title: 'CelesTrak', url: 'https://celestrak.org/' },
] as const

const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function LinkCard({
  title,
  url,
  note,
  action,
}: { title: string; url: string; note: string | null; action?: React.ReactNode }) {
  return (
    <li className="relative flex flex-col gap-1.5 rounded-[12px] border border-line bg-surface p-4 hover:border-line-strong">
      <a href={url} target="_blank" rel="noopener noreferrer" className="pr-10 text-[17px] font-semibold">
        {title} ↗
      </a>
      <span className="text-xs text-muted">{host(url)}</span>
      {note && <p className="m-0 text-sm text-muted">{note}</p>}
      {action}
    </li>
  )
}

/** Useful links: a few built in, and your own (saved to your profile). */
export function Links() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const mine = useQuery({ queryKey: ['links'], queryFn: api.links.list })
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const add = useMutation({
    mutationFn: () => api.links.add({ title: title.trim(), url: url.trim(), note: note.trim() || undefined }),
    onSuccess: () => {
      setTitle('')
      setUrl('')
      setNote('')
      qc.invalidateQueries({ queryKey: ['links'] })
    },
  })
  const remove = useMutation({
    mutationFn: api.links.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['links'] }),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (title.trim() && url.trim()) add.mutate()
  }
  const grid = 'm-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-3 p-0'

  return (
    <div className="flex flex-col gap-8 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-col gap-2">
        <h1 className="m-0 text-[40px] font-extrabold tracking-[-0.025em]">{t('links.title')}</h1>
        <p className="m-0 max-w-[640px] text-muted">{t('links.intro')}</p>
      </header>

      <section aria-labelledby="h-builtin" className="flex flex-col gap-3">
        <SectionHeader id="h-builtin" title={t('links.builtIn')} />
        <ul className={grid}>
          {BUILT_IN.map((l) => (
            <LinkCard key={l.key} title={l.title} url={l.url} note={t(`links.${l.key}`)} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="h-mine" className="flex flex-col gap-3">
        <SectionHeader id="h-mine" title={t('links.mine')} />
        {mine.data?.length === 0 && <p className="m-0 text-sm text-muted">{t('links.none')}</p>}
        {!!mine.data?.length && (
          <ul className={grid}>
            {mine.data.map((l) => (
              <LinkCard
                key={l.id}
                title={l.title}
                url={l.url}
                note={l.note}
                action={
                  <button
                    type="button"
                    aria-label={t('links.remove', { title: l.title })}
                    disabled={remove.isPending}
                    onClick={() =>
                      window.confirm(t('links.confirmRemove', { title: l.title })) && remove.mutate(l.id)
                    }
                    className="absolute right-2 top-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted hover:bg-line-soft hover:text-ink"
                  >
                    <CloseIcon size={16} />
                  </button>
                }
              />
            ))}
          </ul>
        )}
        <form
          onSubmit={submit}
          aria-label={t('links.add')}
          className="flex flex-wrap items-end gap-3 rounded-[12px] border border-line bg-surface p-4"
        >
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-[13px] font-semibold text-muted">
            {t('links.name')}
            <input
              className={inputCls}
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="flex min-w-64 flex-[2_1_0] flex-col gap-1 text-[13px] font-semibold text-muted">
            {t('links.url')}
            <input
              type="url"
              className={inputCls}
              value={url}
              placeholder="https://"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="flex min-w-64 flex-[2_1_0] flex-col gap-1 text-[13px] font-semibold text-muted">
            {t('links.note')}
            <input
              className={inputCls}
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className={btn('primary')}
            disabled={!title.trim() || !url.trim() || add.isPending}
          >
            {t('links.add')}
          </button>
        </form>
        <ErrorNote error={add.error ?? remove.error} />
      </section>
    </div>
  )
}
