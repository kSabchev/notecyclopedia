import { type CalculatorSpec, defaultInputs, evaluateCalculator, formatValue } from '@nc/shared'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalculationSteps } from './calculator/CalculationSteps'
import { PracticeProblem } from './calculator/PracticeProblem'
import { Button, Eyebrow } from './ui'

/**
 * Live calculator UI for any spec. The full view also shows the theory and a step-by-step solution. Both offer a
 * practice problem: the same calculation with new numbers.
 */
export function CalculatorRunner({ spec, compact = false }: { spec: CalculatorSpec; compact?: boolean }) {
  const { t } = useTranslation()
  const [practicing, setPracticing] = useState(false)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(defaultInputs(spec)).map(([k, v]) => [k, String(v)])),
  )
  useEffect(() => {
    setValues(Object.fromEntries(Object.entries(defaultInputs(spec)).map(([k, v]) => [k, String(v)])))
  }, [spec])

  const numbers = useMemo(
    () => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number.parseFloat(v)])),
    [values],
  )
  const result = useMemo(() => evaluateCalculator(spec, numbers), [spec, numbers])
  const theory = (spec.theory ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)

  const runner = (
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
      </div>
    </div>
  )
  const practice = practicing ? (
    <PracticeProblem spec={spec} onClose={() => setPracticing(false)} />
  ) : (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setPracticing(true)}>
        {t('calc.practice.button')}
      </Button>
    </div>
  )
  if (compact)
    return (
      <div className="flex flex-col gap-4">
        {runner}
        {practice}
      </div>
    )

  return (
    <div className="flex flex-col">
      {runner}
      <div className="border-t border-line-soft px-6 py-4">{practice}</div>
      {theory.length > 0 && (
        <section
          aria-labelledby="calc-theory"
          className="flex flex-col gap-2 border-t border-line-soft px-6 py-5"
        >
          <h3 id="calc-theory" className="m-0 text-base font-bold">
            {t('calc.theory')}
          </h3>
          {theory.map((paragraph) => (
            <p
              key={paragraph}
              className="m-0 max-w-[70ch] whitespace-pre-line font-serif text-[16px] leading-relaxed"
            >
              {paragraph}
            </p>
          ))}
        </section>
      )}
      <section
        aria-labelledby="calc-steps"
        className="flex flex-col gap-3 border-t border-line-soft px-6 py-5"
      >
        <h3 id="calc-steps" className="m-0 text-base font-bold">
          {t('calc.steps')}
        </h3>
        <CalculationSteps spec={spec} inputs={numbers} />
      </section>
    </div>
  )
}
