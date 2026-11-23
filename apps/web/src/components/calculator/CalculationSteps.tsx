import { type CalculatorSpec, calculationSteps, formatValue } from '@nc/shared'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** The step-by-step solution of a calculator for the given inputs: each formula, with the values, and the result. */
export function CalculationSteps({ spec, inputs }: { spec: CalculatorSpec; inputs: Record<string, number> }) {
  const { t } = useTranslation()
  const steps = useMemo(() => calculationSteps(spec, inputs), [spec, inputs])
  return (
    <ol className="m-0 flex flex-col gap-4 pl-5">
      {steps.map((step) => (
        <li key={step.key} className="flex flex-col gap-1">
          <span className="font-semibold">{step.label}</span>
          {step.explanation && <span className="text-sm text-muted">{step.explanation}</span>}
          <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{step.formula}</span>
          {step.substituted !== null ? (
            <span className="font-mono text-[13px] [overflow-wrap:anywhere]">= {step.substituted}</span>
          ) : (
            <span className="text-sm text-muted">{t('calc.stepUnavailable')}</span>
          )}
          {step.value !== null && (
            <span className="font-mono text-[13px] font-semibold">
              = {formatValue(step.value, spec.outputs.find((o) => o.key === step.key)?.precision ?? 3)}
              {step.unit ? ` ${step.unit}` : ''}
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}
