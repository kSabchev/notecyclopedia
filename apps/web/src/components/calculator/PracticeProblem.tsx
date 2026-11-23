import {
  type CalculatorSpec,
  answerMatches,
  formatValue,
  newPracticeSeed,
  parseAnswer,
  practiceProblem,
} from '@nc/shared'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui'
import { CalculationSteps } from './CalculationSteps'

/**
 * A problem like the calculator's, with new numbers (no AI): the given values, a box for each answer, a check that
 * marks answers right or wrong without giving them away, and the full solution on request.
 */
export function PracticeProblem({ spec, onClose }: { spec: CalculatorSpec; onClose: () => void }) {
  const { t } = useTranslation()
  const id = useId()
  const [seed, setSeed] = useState(newPracticeSeed)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const problem = useMemo(() => practiceProblem(spec, seed), [spec, seed])

  const next = () => {
    setSeed(newPracticeSeed())
    setAnswers({})
    setChecked(false)
    setRevealed(false)
  }
  const answered = spec.outputs.filter((o) => answers[o.key]?.trim())
  const right = answered.filter((o) =>
    answerMatches(parseAnswer(answers[o.key] ?? ''), problem?.values[o.key] ?? Number.NaN, o.precision ?? 3),
  )

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 rounded-[12px] border border-line bg-bg p-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id={`${id}-title`} className="m-0 text-base font-bold">
            {t('calc.practice.title')}
          </h3>
          <p className="m-0 text-sm text-muted">{t('calc.practice.intro')}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={next}>
          {t('calc.practice.next')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('calc.practice.close')}
        </Button>
      </div>

      {!problem ? (
        <p className="m-0 text-sm text-danger">{t('calc.practice.none')}</p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h4 className="m-0 text-sm font-bold">{t('calc.practice.given')}</h4>
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t('calc.practice.given')}>
              {spec.inputs.map((input) => (
                <li key={input.key} className="flex flex-wrap gap-x-2">
                  <span>{input.label}:</span>
                  <span className="font-mono font-semibold">
                    {formatValue(problem.inputs[input.key] ?? Number.NaN, 6)}
                    {input.unit ? ` ${input.unit}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="m-0 text-sm font-bold">{t('calc.practice.find')}</h4>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {spec.outputs.map((output) => {
                const inputId = `${id}-${output.key}`
                const text = answers[output.key] ?? ''
                const exact = problem.values[output.key] ?? Number.NaN
                const given = parseAnswer(text)
                const mark = checked && text.trim()
                return (
                  <li key={output.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <label htmlFor={inputId} className="min-w-40 flex-1 text-sm font-semibold">
                      {output.label}
                    </label>
                    <div className="flex items-center overflow-hidden rounded-[10px] border border-line-strong bg-surface focus-within:outline-2 focus-within:outline-accent">
                      <input
                        id={inputId}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder={t('calc.practice.answer')}
                        value={text}
                        onChange={(e) => {
                          setAnswers((a) => ({ ...a, [output.key]: e.target.value }))
                          setChecked(false)
                        }}
                        className="h-10 w-36 min-w-0 border-0 px-3 font-mono text-base outline-none"
                      />
                      {output.unit && (
                        <span className="px-3 font-mono text-[13px] text-muted">{output.unit}</span>
                      )}
                    </div>
                    <span className="min-w-28 text-sm" aria-live="polite">
                      {mark &&
                        (Number.isNaN(given) ? (
                          <span className="text-danger">{t('calc.practice.unreadable')}</span>
                        ) : answerMatches(given, exact, output.precision ?? 3) ? (
                          <span className="font-semibold text-accent">✓ {t('calc.practice.correct')}</span>
                        ) : (
                          <span className="font-semibold text-danger">✗ {t('calc.practice.wrong')}</span>
                        ))}
                    </span>
                    {revealed && (
                      <span className="basis-full font-mono text-[13px] text-muted">
                        {t('calc.practice.exact', {
                          value: `${formatValue(exact, output.precision ?? 3)}${output.unit ? ` ${output.unit}` : ''}`,
                        })}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="primary" disabled={!answered.length} onClick={() => setChecked(true)}>
              {t('calc.practice.check')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRevealed((r) => !r)}>
              {revealed ? t('calc.practice.hide') : t('calc.practice.reveal')}
            </Button>
            {checked && answered.length > 0 && (
              <span className="text-sm text-muted" aria-live="polite">
                {t('calc.practice.score', { right: right.length, total: answered.length })}
              </span>
            )}
          </div>

          {revealed && (
            <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
              <h4 className="m-0 text-sm font-bold">{t('calc.steps')}</h4>
              <CalculationSteps spec={spec} inputs={problem.inputs} />
            </div>
          )}
        </>
      )}
    </section>
  )
}
