import {
  type CalculatorSpec,
  MAX_PLOT_SERIES,
  type WidgetAttrs,
  defaultPlotRange,
  widgetAttrsSchema,
} from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { Button, ErrorNote, Field, inputCls } from '../ui'

const KEEP = ''

/** Choose a library calculator and how to show it. `initial` is the block being edited, if any. */
export function WidgetDialog({
  initial,
  onSubmit,
  onClose,
}: {
  initial?: WidgetAttrs
  onSubmit: (attrs: WidgetAttrs) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  // Always refetch: a calculator may have been created moments ago, e.g. in another tab.
  const calculators = useQuery({ queryKey: ['calculators'], queryFn: api.calculators.list, staleTime: 0 })
  const [sourceId, setSourceId] = useState(initial ? KEEP : '')
  const [kind, setKind] = useState<WidgetAttrs['kind']>(initial?.kind ?? 'calculator')
  const initialPlot = initial?.kind === 'plot' ? initial.plot : undefined
  const [x, setX] = useState(initialPlot?.x ?? '')
  const [y, setY] = useState<string[]>(initialPlot?.y ?? [])
  const [from, setFrom] = useState(initialPlot ? String(initialPlot.from) : '')
  const [to, setTo] = useState(initialPlot ? String(initialPlot.to) : '')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  // Without a block to edit, start from the first library calculator.
  useEffect(() => {
    if (!initial && !sourceId && calculators.data?.[0]) setSourceId(calculators.data[0].id)
  }, [initial, sourceId, calculators.data])

  const chosen = calculators.data?.find((c) => c.id === sourceId)
  const spec: CalculatorSpec | undefined = sourceId === KEEP ? initial?.spec : chosen?.spec

  // Keep the plot settings valid for the chosen calculator.
  useEffect(() => {
    if (!spec) return
    const inputKey = spec.inputs.some((i) => i.key === x) ? x : (spec.inputs[0]?.key ?? '')
    if (inputKey !== x) {
      setX(inputKey)
      const range = defaultPlotRange(spec, inputKey)
      setFrom(String(range.from))
      setTo(String(range.to))
    }
    setY((current) => {
      const kept = current.filter((key) => spec.outputs.some((o) => o.key === key))
      return kept.length ? kept : spec.outputs.slice(0, 1).map((o) => o.key)
    })
  }, [spec, x])

  const submit = () => {
    if (!spec) return
    const sourceCalculatorId = sourceId === KEEP ? (initial?.sourceCalculatorId ?? null) : sourceId
    const candidate =
      kind === 'plot'
        ? { kind, spec, sourceCalculatorId, plot: { x, y, from: Number(from), to: Number(to) } }
        : { kind, spec, sourceCalculatorId }
    const parsed = widgetAttrsSchema.safeParse(candidate)
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '))
      return
    }
    onSubmit(parsed.data)
  }

  const noCalculators = !initial && !calculators.isFetching && calculators.data?.length === 0
  // Rendered outside the editor so typing in the dialog never reaches the document underneath.
  return createPortal(
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="widget-dialog-title"
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-[14px] border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
    >
      <form
        method="dialog"
        className="flex flex-col gap-4 p-6"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <h2 id="widget-dialog-title" className="m-0 text-lg font-bold">
          {initial ? t('widget.editTitle') : t('widget.insertTitle')}
        </h2>
        {noCalculators ? (
          <p className="m-0 text-muted">{t('widget.noCalculators')}</p>
        ) : (
          <>
            <Field label={t('widget.source')} htmlFor="widget-source">
              <select
                id="widget-source"
                className={inputCls}
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              >
                {initial && (
                  <option value={KEEP}>{t('widget.keepCurrent', { name: initial.spec.name })}</option>
                )}
                {calculators.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
              <legend className="mb-1.5 text-[13px] font-semibold text-muted">{t('widget.kind')}</legend>
              {(['calculator', 'plot'] as const).map((k) => (
                <label
                  key={k}
                  className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"
                >
                  <input
                    type="radio"
                    name="widget-kind"
                    className="h-[18px] w-[18px] accent-accent"
                    checked={kind === k}
                    onChange={() => setKind(k)}
                  />
                  {k === 'plot' ? t('widget.kindPlot') : t('widget.kindCalculator')}
                </label>
              ))}
            </fieldset>
            {kind === 'plot' && spec && (
              <>
                <Field label={t('widget.xAxis')} htmlFor="widget-x">
                  <select
                    id="widget-x"
                    className={inputCls}
                    value={x}
                    onChange={(e) => {
                      setX(e.target.value)
                      const range = defaultPlotRange(spec, e.target.value)
                      setFrom(String(range.from))
                      setTo(String(range.to))
                    }}
                  >
                    {spec.inputs.map((i) => (
                      <option key={i.key} value={i.key}>
                        {i.label}
                        {i.unit ? ` (${i.unit})` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex gap-3">
                  <Field label={t('widget.from')} htmlFor="widget-from">
                    <input
                      id="widget-from"
                      type="number"
                      step="any"
                      className={`${inputCls} w-full font-mono`}
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </Field>
                  <Field label={t('widget.to')} htmlFor="widget-to">
                    <input
                      id="widget-to"
                      type="number"
                      step="any"
                      className={`${inputCls} w-full font-mono`}
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </Field>
                </div>
                <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
                  <legend className="mb-1.5 text-[13px] font-semibold text-muted">
                    {t('widget.yAxis', { max: MAX_PLOT_SERIES })}
                  </legend>
                  {spec.outputs.map((o) => {
                    const checked = y.includes(o.key)
                    return (
                      <label
                        key={o.key}
                        className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="h-[18px] w-[18px] accent-accent"
                          checked={checked}
                          disabled={!checked && y.length >= MAX_PLOT_SERIES}
                          onChange={(e) =>
                            setY((cur) =>
                              e.target.checked
                                ? spec.outputs
                                    .map((out) => out.key)
                                    .filter((k) => k === o.key || cur.includes(k))
                                : cur.filter((k) => k !== o.key),
                            )
                          }
                        />
                        {o.label}
                        {o.unit && <span className="text-muted">({o.unit})</span>}
                      </label>
                    )
                  })}
                </fieldset>
              </>
            )}
          </>
        )}
        <ErrorNote error={error ?? calculators.error} />
        <div className="flex justify-end gap-2.5">
          <Button size="sm" onClick={() => dialog.current?.close()}>
            {t('widget.cancel')}
          </Button>
          {!noCalculators && (
            <Button size="sm" variant="primary" type="submit" disabled={!spec}>
              {initial ? t('widget.save') : t('widget.insert')}
            </Button>
          )}
        </div>
      </form>
    </dialog>,
    document.body,
  )
}
