import { type CalculatorSpec, defaultInputs, evaluateCalculator, formatValue } from '@nc/shared'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eyebrow } from './ui'

/** Live calculator UI for any spec. */
export function CalculatorRunner({ spec, compact = false }: { spec: CalculatorSpec; compact?: boolean }) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(defaultInputs(spec)).map(([k, v]) => [k, String(v)])),
  )
  useEffect(() => {
    setValues(Object.fromEntries(Object.entries(defaultInputs(spec)).map(([k, v]) => [k, String(v)])))
  }, [spec])

  const result = useMemo(
    () =>
      evaluateCalculator(
        spec,
        Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number.parseFloat(v)])),
      ),
    [spec, values],
  )

  return (
    <div className={`flex flex-wrap ${compact ? 'gap-5' : ''}`}>
      <div
        className={`flex flex-col gap-4 ${compact ? 'flex-[2_1_320px] flex-row flex-wrap' : 'flex-[1_1_240px] border-line-soft p-6 sm:border-r'}`}
      >
        {!compact && <Eyebrow>{t('calc.inputs')}</Eyebrow>}
        {spec.inputs.map((inp) => {
          const id = `in-${inp.key}`
          return (
            <div key={inp.key} className={`flex flex-col gap-1.5 ${compact ? 'min-w-40 flex-1' : ''}`}>
              <label htmlFor={id} className="text-sm font-semibold">
                {inp.label}
              </label>
              <div className="flex items-center overflow-hidden rounded-[10px] border border-line-strong bg-surface focus-within:outline-2 focus-within:outline-accent">
                <input
                  id={id}
                  type="number"
                  step={inp.step ?? 'any'}
                  min={inp.min}
                  max={inp.max}
                  value={values[inp.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [inp.key]: e.target.value }))}
                  className="h-11 min-w-0 flex-1 border-0 px-3 font-mono text-base outline-none"
                />
                {inp.unit && <span className="px-3 font-mono text-[13px] text-muted">{inp.unit}</span>}
              </div>
            </div>
          )
        })}
      </div>
      <div className={`flex flex-col gap-4 ${compact ? 'flex-[1_1_240px]' : 'flex-[2_1_320px] p-6'}`}>
        {!compact && <Eyebrow>{t('calc.results')}</Eyebrow>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3" aria-live="polite">
          {spec.outputs.map((out, i) => (
            <div
              key={out.key}
              className={`flex flex-col gap-1 rounded-[10px] p-3.5 ${i === spec.outputs.length - 1 ? 'bg-accent-soft' : 'bg-bg'}`}
            >
              <span
                className={`text-[13px] font-semibold ${i === spec.outputs.length - 1 ? 'text-accent-hover' : 'text-muted'}`}
              >
                {out.label}
              </span>
              <span className="font-mono text-2xl font-medium">
                {result.ok ? formatValue(result.values[out.key] ?? Number.NaN, out.precision ?? 3) : '–'}
                {out.unit && <span className="text-sm"> {out.unit}</span>}
              </span>
            </div>
          ))}
        </div>
        {!result.ok && <p className="m-0 text-sm text-danger">{result.error}</p>}
        {!compact && (
          <div className="flex flex-col gap-1 font-mono text-[13px] text-muted">
            {spec.outputs.map((o) => (
              <span key={o.key}>
                {o.key} = {o.expr}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
