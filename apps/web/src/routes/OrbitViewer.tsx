import { CENTRAL_BODIES, ORBIT_PRESETS, type OrbitalElements, orbitalElementsSchema } from '@nc/shared'
import { useSearch } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { OrbitView } from '../components/widgets/OrbitView'

/** Elements and central body from the URL, e.g. `/orbit?a=26600&e=0.74&i=63.4&argp=270`. */
export interface OrbitSearch {
  body?: string
  a?: number
  e?: number
  i?: number
  raan?: number
  argp?: number
  nu?: number
}

const START = (ORBIT_PRESETS.find((p) => p.key === 'molniya') ?? ORBIT_PRESETS[0])
  ?.elements as OrbitalElements

/** A standalone orbit diagram, also opened from GMAT and FreeFlyer files with their spacecraft's elements. */
export function OrbitViewer() {
  const { t } = useTranslation()
  const search = useSearch({ from: '/app/orbit' })
  const body = CENTRAL_BODIES.some((b) => b.key === search.body) ? (search.body as string) : 'earth'
  const elements = useMemo(() => {
    const given = Object.fromEntries(
      Object.entries(search).filter(([k, v]) => k !== 'body' && Number.isFinite(v)),
    )
    const parsed = orbitalElementsSchema.safeParse({ ...START, ...given })
    return parsed.success ? parsed.data : START
  }, [search])

  return (
    <div className="flex flex-col gap-6 px-6 pb-18 pt-10 md:px-12">
      <header className="flex max-w-[640px] flex-col gap-2">
        <h1 className="m-0 text-[40px] font-extrabold tracking-[-0.025em]">{t('orbit.viewerTitle')}</h1>
        <p className="m-0 text-[17px] text-muted">{t('orbit.viewerSubtitle')}</p>
      </header>
      <div className="max-w-[1100px] overflow-hidden rounded-[14px] border border-line bg-surface">
        <OrbitView body={body} elements={elements} />
      </div>
    </div>
  )
}
