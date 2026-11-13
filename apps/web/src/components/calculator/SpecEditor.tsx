import { BUILT_IN_CONSTANTS, type CalculatorSpec } from '@nc/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { ErrorNote, btn, inputCls } from '../ui'

/**
 * The visual editor of a calculator: name, description and theory, the inputs, the constants (picked from the
 * built-in and course constants), and the results with their formulas and step explanations.
 */
export function SpecEditor({
  spec,
  update,
  onMakeConstant,
  courseId,
}: {
  spec: CalculatorSpec
  /** Changes the spec being edited. */
  update: (change: (current: CalculatorSpec) => CalculatorSpec) => void
  /** Turns an input into a constant (such as μ). */
  onMakeConstant: (key: string) => void
  /** The course the calculator is tagged with: its constants can be picked too. */
  courseId: string | null
}) {
  const { t } = useTranslation()
  const [constantSelection, setConstantSelection] = useState('')
  const courseConstants = useQuery({
    queryKey: ['course-constants', courseId],
    queryFn: () => api.courses.constants(courseId ?? ''),
    enabled: !!courseId,
  })
  const constantOptions = [
    ...BUILT_IN_CONSTANTS,
    ...(courseConstants.data ?? []).map((constant) => ({
      key: constant.key,
      name: constant.name,
      symbol: constant.symbol,
      value: constant.value,
      unit: constant.unit,
      description: constant.description ?? '',
      source: t('constants.courseSource'),
    })),
  ]
  const selectedConstant = constantOptions.find((constant) => constant.key === constantSelection)
  const collidingConstant =
    selectedConstant &&
    (spec.inputs.some((input) => input.key === selectedConstant.key) ||
      spec.outputs.some((output) => output.key === selectedConstant.key))
  const addConstant = () => {
    if (!selectedConstant || collidingConstant) return
    update((current) => ({
      ...current,
      constants: { ...current.constants, [selectedConstant.key]: selectedConstant.value },
      constantMetadata: {
        ...current.constantMetadata,
        [selectedConstant.key]: {
          name: selectedConstant.name,
          symbol: selectedConstant.symbol,
          unit: selectedConstant.unit,
        },
      },
    }))
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
          {t('calc.name')}
          <input
            className={inputCls}
            value={spec.name}
            onChange={(e) => update((current) => ({ ...current, name: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
          {t('calc.description')}
          <input
            className={inputCls}
            value={spec.description ?? ''}
            onChange={(e) =>
              update((current) => ({
                ...current,
                description: e.target.value || undefined,
              }))
            }
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
        {t('calc.theory')}
        <textarea
          rows={4}
          className="rounded-[10px] border border-line-strong bg-surface p-3 text-[15px] font-normal text-ink"
          value={spec.theory ?? ''}
          onChange={(e) => update((current) => ({ ...current, theory: e.target.value || undefined }))}
        />
        <span className="text-xs font-normal">{t('calc.theoryHint')}</span>
      </label>
      <section className="flex flex-col gap-3">
        <h3 className="m-0 text-base font-bold">{t('calc.inputs')}</h3>
        {spec.inputs.map((input, index) => (
          <div
            key={`${index}-${input.key}`}
            className="grid gap-2 rounded-[10px] border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            {(
              [
                ['key', t('calc.key')],
                ['label', t('calc.label')],
                ['unit', t('calc.unit')],
                ['default', t('calc.defaultValue')],
                ['min', t('calc.minimum')],
                ['max', t('calc.maximum')],
                ['step', t('calc.step')],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="flex flex-col gap-1 text-xs font-semibold text-muted">
                {label}
                <input
                  className={inputCls}
                  type={['default', 'min', 'max', 'step'].includes(field) ? 'number' : 'text'}
                  value={input[field] ?? ''}
                  onChange={(e) =>
                    update((current) => ({
                      ...current,
                      inputs: current.inputs.map((item, i) =>
                        i !== index
                          ? item
                          : {
                              ...item,
                              [field]: ['default', 'min', 'max', 'step'].includes(field)
                                ? e.target.value === ''
                                  ? undefined
                                  : Number(e.target.value)
                                : e.target.value || (field === 'unit' ? undefined : ''),
                            },
                      ),
                    }))
                  }
                />
              </label>
            ))}
            <div className="flex flex-wrap justify-end gap-2 sm:col-span-2 lg:col-span-4">
              <button
                type="button"
                className={btn('secondary', 'sm')}
                title={t('calc.inputToConstantHint')}
                disabled={spec.inputs.length === 1 || input.default === undefined}
                onClick={() => onMakeConstant(input.key)}
              >
                {t('calc.inputToConstant')}
              </button>
              <button
                type="button"
                className={btn('danger', 'sm')}
                disabled={spec.inputs.length === 1}
                onClick={() =>
                  update((current) => ({
                    ...current,
                    inputs: current.inputs.filter((_, i) => i !== index),
                  }))
                }
              >
                {t('calc.removeInput')}
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className={`${btn('secondary', 'sm')} self-start`}
          onClick={() =>
            update((current) => ({
              ...current,
              inputs: [
                ...current.inputs,
                { key: `input${current.inputs.length + 1}`, label: t('calc.newInput') },
              ],
            }))
          }
        >
          {t('calc.addInput')}
        </button>
      </section>
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="m-0 text-base font-bold">{t('constants.title')}</h3>
          <p className="m-0 text-xs text-muted">{t('constants.calculatorHint')}</p>
        </div>
        {Object.entries(spec.constants ?? {}).map(([key, value]) => {
          const metadata = spec.constantMetadata?.[key]
          return (
            <div
              key={key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3"
            >
              <span>
                <strong>{metadata?.name ?? key}</strong>
                {metadata && <span className="ml-1 text-muted">({metadata.symbol})</span>}
                <span className="ml-2 font-mono text-sm">
                  {value.toExponential(8)} {metadata?.unit ?? ''}
                </span>
                <span className="ml-2 font-mono text-xs text-muted">{key}</span>
              </span>
              <button
                type="button"
                className={btn('danger', 'sm')}
                onClick={() =>
                  update((current) => {
                    const constants = { ...current.constants }
                    const constantMetadata = { ...current.constantMetadata }
                    delete constants[key]
                    delete constantMetadata[key]
                    return { ...current, constants, constantMetadata }
                  })
                }
              >
                {t('calc.removeConstant')}
              </button>
            </div>
          )
        })}
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1.5 text-xs font-semibold text-muted">
            {t('constants.pick')}
            <select
              className={inputCls}
              value={constantSelection}
              onChange={(event) => setConstantSelection(event.target.value)}
            >
              <option value="">{t('constants.choose')}</option>
              {constantOptions.map((constant) => (
                <option key={constant.key} value={constant.key}>
                  {constant.name} ({constant.symbol}) · {constant.key} · {constant.unit}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={btn('secondary', 'sm')}
            disabled={!selectedConstant || !!collidingConstant}
            onClick={addConstant}
          >
            {t('constants.useInCalculator')}
          </button>
        </div>
        {collidingConstant && <ErrorNote error={t('constants.keyConflict', { key: selectedConstant.key })} />}
        {courseId && <ErrorNote error={courseConstants.error} />}
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="m-0 text-base font-bold">{t('calc.results')}</h3>
        {spec.outputs.map((output, index) => (
          <div
            key={`${index}-${output.key}`}
            className="grid gap-2 rounded-[10px] border border-line bg-surface p-3 sm:grid-cols-2"
          >
            {(
              [
                ['key', t('calc.key')],
                ['label', t('calc.label')],
                ['unit', t('calc.unit')],
                ['expr', t('calc.formula')],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="flex flex-col gap-1 text-xs font-semibold text-muted">
                {label}
                <input
                  className={`${inputCls} ${field === 'expr' ? 'font-mono' : ''}`}
                  value={output[field] ?? ''}
                  onChange={(e) =>
                    update((current) => ({
                      ...current,
                      outputs: current.outputs.map((item, i) =>
                        i !== index
                          ? item
                          : {
                              ...item,
                              [field]: e.target.value || (field === 'unit' ? undefined : ''),
                            },
                      ),
                    }))
                  }
                />
              </label>
            ))}
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted sm:col-span-2">
              {t('calc.explanation')}
              <textarea
                rows={2}
                className="rounded-[10px] border border-line-strong bg-surface p-2.5 text-sm font-normal text-ink"
                value={output.explanation ?? ''}
                onChange={(e) =>
                  update((current) => ({
                    ...current,
                    outputs: current.outputs.map((item, i) =>
                      i !== index ? item : { ...item, explanation: e.target.value || undefined },
                    ),
                  }))
                }
              />
            </label>
            <button
              type="button"
              className={`${btn('danger', 'sm')} sm:col-span-2 sm:justify-self-end`}
              disabled={spec.outputs.length === 1}
              onClick={() =>
                update((current) => ({
                  ...current,
                  outputs: current.outputs.filter((_, i) => i !== index),
                }))
              }
            >
              {t('calc.removeOutput')}
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${btn('secondary', 'sm')} self-start`}
          onClick={() =>
            update((current) => ({
              ...current,
              outputs: [
                ...current.outputs,
                {
                  key: `output${current.outputs.length + 1}`,
                  label: t('calc.newOutput'),
                  expr: '',
                },
              ],
            }))
          }
        >
          {t('calc.addOutput')}
        </button>
      </section>
      <p className="m-0 text-sm text-muted">{t('calc.formulaHint')}</p>
    </div>
  )
}
