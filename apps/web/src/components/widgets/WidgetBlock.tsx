import {
  type CalculatorSpec,
  type PlotConfig,
  type WidgetAttrs,
  defaultInputs,
  formatValue,
  samplePlot,
  widgetAttrsSchema,
} from '@nc/shared'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { CalculatorRunner } from '../CalculatorRunner'
import { Button, ErrorNote } from '../ui'
import { PlotChart, type PlotSeries } from './PlotChart'
import { WidgetDialog } from './WidgetDialog'

/** Rows shown in the table view: evenly spaced samples, not all of them. */
const TABLE_ROWS = 11

function PlotWidget({ spec, plot }: { spec: CalculatorSpec; plot: PlotConfig }) {
  const { t } = useTranslation()
  const [values, setValues] = useState(() => defaultInputs(spec))
  const [table, setTable] = useState(false)
  useEffect(() => setValues(defaultInputs(spec)), [spec])

  const x = spec.inputs.find((i) => i.key === plot.x)
  const points = useMemo(() => samplePlot(spec, plot, values), [spec, plot, values])
  // One chart per unit: outputs with different units never share a y-axis.
  const groups = useMemo(() => {
    const byUnit = new Map<string, PlotSeries[]>()
    spec.outputs.forEach((o, slot) => {
      if (!plot.y.includes(o.key)) return
      const unit = o.unit ?? ''
      byUnit.set(unit, [...(byUnit.get(unit) ?? []), { key: o.key, label: o.label, unit: o.unit, slot }])
    })
    return [...byUnit.values()]
  }, [spec, plot])
  const plotted = groups.flat()
  const others = spec.inputs.filter((i) => i.key !== plot.x)
  const xLabel = x ? `${x.label}${x.unit ? ` (${x.unit})` : ''}` : plot.x
  const tableRows = points.filter(
    (_, i) =>
      i % Math.max(1, Math.round((points.length - 1) / (TABLE_ROWS - 1))) === 0 || i === points.length - 1,
  )

  return (
    <div className="flex flex-col gap-5 p-5">
      {others.length > 0 && (
        <div className="flex flex-wrap gap-3" aria-label={t('widget.otherInputs')}>
          {others.map((inp) => (
            <label key={inp.key} className="flex min-w-36 flex-1 flex-col gap-1 text-[13px] font-semibold">
              {inp.label}
              <span className="flex items-center overflow-hidden rounded-[10px] border border-line-strong bg-surface focus-within:outline-2 focus-within:outline-accent">
                <input
                  type="number"
                  step={inp.step ?? 'any'}
                  value={Number.isFinite(values[inp.key]) ? values[inp.key] : ''}
                  onChange={(e) => setValues((v) => ({ ...v, [inp.key]: Number.parseFloat(e.target.value) }))}
                  className="h-10 min-w-0 flex-1 border-0 bg-transparent px-3 font-mono text-[15px] font-normal outline-none"
                />
                {inp.unit && (
                  <span className="px-3 font-mono text-xs font-normal text-muted">{inp.unit}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
      {groups.map((series) => (
        <PlotChart
          key={series.map((s) => s.key).join()}
          points={points}
          series={series}
          xLabel={xLabel}
          title={t('widget.plotAgainst', {
            outputs: series.map((s) => s.label).join(', '),
            input: x?.label ?? plot.x,
          })}
        />
      ))}
      <div>
        <Button size="sm" variant="ghost" aria-expanded={table} onClick={() => setTable((v) => !v)}>
          {table ? t('widget.hideTable') : t('widget.showTable')}
        </Button>
      </div>
      {table && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right font-mono text-[13px]">
            <thead>
              <tr className="border-b border-line text-muted">
                <th className="px-2 py-1.5 font-sans font-semibold">{xLabel}</th>
                {plotted.map((s) => (
                  <th key={s.key} className="px-2 py-1.5 font-sans font-semibold">
                    {s.label}
                    {s.unit ? ` (${s.unit})` : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((p) => (
                <tr key={p.x} className="border-b border-line-soft">
                  <td className="px-2 py-1">{formatValue(p.x, 3)}</td>
                  {plotted.map((s) => {
                    const v = p.y[s.key]
                    return (
                      <td key={s.key} className="px-2 py-1">
                        {v == null ? '–' : formatValue(v, 3)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** An embedded calculator or plot. Editors can change its settings or pull in the library version. */
export default function WidgetBlock({
  attrs,
  editable,
  onChange,
  onDelete,
}: {
  attrs: Record<string, unknown>
  editable: boolean
  onChange: (attrs: WidgetAttrs) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const parsed = useMemo(() => widgetAttrsSchema.safeParse(attrs), [attrs])
  const widget = parsed.success ? parsed.data : null

  const updateFromLibrary = async () => {
    if (!widget?.sourceCalculatorId) return
    try {
      const latest = await api.calculators.get(widget.sourceCalculatorId)
      const next = widgetAttrsSchema.safeParse({ ...widget, spec: latest.spec })
      if (!next.success) throw new Error(next.error.issues.map((i) => i.message).join('; '))
      onChange(next.data)
      setStatus({ ok: true, text: t('widget.updated') })
    } catch (e) {
      setStatus({ ok: false, text: t('widget.updateFailed', { error: (e as Error).message }) })
    }
  }

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface font-sans">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-surface-2 px-5 py-3">
        <span className="min-w-0 flex-1 font-semibold">{widget?.spec.name ?? t('widget.calculator')}</span>
        {editable && (
          <>
            {widget?.sourceCalculatorId && (
              <Button size="sm" variant="ghost" onClick={updateFromLibrary}>
                {t('widget.updateFromLibrary')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {t('widget.settings')}
            </Button>
            <Button size="sm" variant="danger" onClick={onDelete}>
              {t('widget.remove')}
            </Button>
          </>
        )}
      </div>
      {status && (
        <p role="status" className={`m-0 px-5 pt-3 text-sm ${status.ok ? 'text-ok' : 'text-danger'}`}>
          {status.text}
        </p>
      )}
      {!widget && (
        <div className="p-5">
          <ErrorNote
            error={t('widget.invalid', {
              error: parsed.error?.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '),
            })}
          />
        </div>
      )}
      {widget?.kind === 'calculator' && (
        <div className="p-5">
          <CalculatorRunner spec={widget.spec} compact />
        </div>
      )}
      {widget?.kind === 'plot' && <PlotWidget spec={widget.spec} plot={widget.plot} />}
      {editing && (
        <WidgetDialog
          initial={widget ?? undefined}
          onClose={() => setEditing(false)}
          onSubmit={(next) => {
            onChange(next)
            setEditing(false)
            setStatus(null)
          }}
        />
      )}
    </div>
  )
}
