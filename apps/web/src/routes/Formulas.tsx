import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tex } from '../components/Tex'
import { Empty, inputCls } from '../components/ui'
import { api } from '../lib/api'

export function Formulas() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState('')
  const formulas = useQuery({ queryKey: ['formulas', 'all'], queryFn: () => api.formulas() })
  const shown = useMemo(() => {
    const f = filter.toLowerCase()
    return (formulas.data ?? []).filter(
      (x) => !f || `${x.latex} ${x.description ?? ''} ${x.pageTitle}`.toLowerCase().includes(f),
    )
  }, [formulas.data, filter])
  return (
    <div className="flex max-w-[1100px] flex-col gap-6 px-6 pb-18 pt-10 md:px-12">
      <h1 className="m-0 text-[40px] font-extrabold tracking-[-0.025em]">{t('nav.formulas')}</h1>
      <label htmlFor="ff" className="sr-only">
        Filter
      </label>
      <input
        id="ff"
        className={`${inputCls} max-w-md`}
        placeholder="v_0, ускорение…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {shown.length === 0 && !formulas.isPending && <Empty>{t('home.noPinned')}</Empty>}
      <div className="flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface">
        {shown.map((f, i) => (
          <div
            key={f.id}
            className={`flex flex-wrap items-center gap-4 px-5 py-4 ${i ? 'border-t border-line-soft' : ''}`}
          >
            <Tex latex={f.latex} className="min-w-0 flex-[1_1_280px] overflow-x-auto text-[22px]" />
            {f.description && <span className="text-sm text-muted">{f.description}</span>}
            {f.label && <span className="font-mono text-sm text-muted">({f.label})</span>}
            <Link to="/pages/$pageId" params={{ pageId: f.pageId }} className="text-sm font-semibold">
              {f.pageTitle}
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
