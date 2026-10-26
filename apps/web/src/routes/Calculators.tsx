import { BUILT_IN_CONSTANTS, type Calculator, type CalculatorSpec, calculatorSpecSchema } from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalculatorRunner } from '../components/CalculatorRunner'
import { Empty, ErrorNote, Eyebrow, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'

const TEMPLATE: CalculatorSpec = {
  version: 1,
  name: 'New calculator',
  inputs: [
    { key: 'v0', label: 'Initial speed', unit: 'm/s', default: 10 },
    { key: 'a', label: 'Acceleration', unit: 'm/s²', default: 2 },
    { key: 't', label: 'Time', unit: 's', default: 3 },
  ],
  outputs: [{ key: 'v', label: 'Final speed', unit: 'm/s', expr: 'v0 + a * t' }],
}

function parseSpec(text: string): { spec?: CalculatorSpec; error?: string } {
  try {
    const r = calculatorSpecSchema.safeParse(JSON.parse(text))
    if (r.success) return { spec: r.data }
    return { error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

function Detail({
  calc,
  isNew,
  onCancelNew,
}: { calc: Calculator | null; isNew: boolean; onCancelNew: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const [editing, setEditing] = useState(isNew)
  const [text, setText] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [constantSelection, setConstantSelection] = useState('')
  const [visualSpec, setVisualSpec] = useState<CalculatorSpec>(calc?.spec ?? TEMPLATE)
  const [courseId, setCourseId] = useState<string | null>(calc?.courseId ?? null)
  const courseConstants = useQuery({
    queryKey: ['course-constants', courseId],
    queryFn: () => api.courses.constants(courseId ?? ''),
    enabled: !!courseId,
  })
  useEffect(() => {
    const initialSpec = calc?.spec ?? TEMPLATE
    setText(JSON.stringify(initialSpec, null, 2))
    setVisualSpec(initialSpec)
    setAdvanced(false)
    setEditing(isNew)
    setCourseId(calc?.courseId ?? null)
  }, [calc, isNew])

  const parsed = parseSpec(text)
  const spec = editing ? visualSpec : calc?.spec
  const updateSpec = (update: (current: CalculatorSpec) => CalculatorSpec) => {
    const next = update(visualSpec)
    setVisualSpec(next)
    setText(JSON.stringify(next, null, 2))
  }
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
    (visualSpec.inputs.some((input) => input.key === selectedConstant.key) ||
      visualSpec.outputs.some((output) => output.key === selectedConstant.key))
  const addConstant = () => {
    if (!selectedConstant || collidingConstant) return
    updateSpec((current) => ({
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
  const save = useMutation({
    mutationFn: () => {
      if (!parsed.spec) throw new Error(t('calc.invalid'))
      return calc
        ? api.calculators.update(calc.id, { spec: parsed.spec, courseId })
        : api.calculators.create({ spec: parsed.spec, courseId })
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['calculators'] })
      setEditing(false)
      navigate({ to: '/calculators/$calcId', params: { calcId: c.id } })
    },
  })
  const remove = useMutation({
    mutationFn: () => api.calculators.remove(calc?.id ?? ''),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calculators'] })
      navigate({ to: '/calculators' })
    },
  })

  return (
    <section
      aria-labelledby="h-calc"
      className="flex min-w-0 flex-[2_1_540px] flex-col overflow-hidden rounded-[16px] border border-line bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-calc" className="m-0 text-[22px] font-bold">
            {spec?.name ?? calc?.name ?? t('calc.new')}
          </h2>
          {spec?.description && <span className="text-sm text-muted">{spec.description}</span>}
          {calc?.sourcePageId && (
            <Link to="/pages/$pageId" params={{ pageId: calc.sourcePageId }} className="text-sm">
              ↗ source
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <button
                type="button"
                className={btn('secondary', 'sm')}
                onClick={() => (calc ? setEditing(false) : onCancelNew())}
              >
                {t('calc.cancel')}
              </button>
              <button
                type="button"
                className={btn('primary', 'sm')}
                disabled={!parsed.spec || save.isPending}
                onClick={() => save.mutate()}
              >
                {t('calc.save')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={btn('secondary', 'sm')} onClick={() => setEditing(true)}>
                {t('calc.edit')}
              </button>
              <button
                type="button"
                className={btn('danger', 'sm')}
                onClick={() => window.confirm(`${t('calc.delete')}?`) && remove.mutate()}
              >
                {t('calc.delete')}
              </button>
            </>
          )}
        </div>
      </div>

      {spec ? (
        <CalculatorRunner spec={spec} />
      ) : (
        <div className="p-6">
          <ErrorNote error={parsed.error} />
        </div>
      )}

      {editing && (
        <div className="flex flex-col gap-3 border-t border-line bg-surface-2 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              {advanced ? t('calc.definition') : t('calc.editor')}
            </span>
            <button
              type="button"
              className={btn('secondary', 'sm')}
              disabled={advanced && !parsed.spec}
              onClick={() => {
                if (advanced && parsed.spec) setVisualSpec(parsed.spec)
                setAdvanced((value) => !value)
              }}
            >
              {advanced ? t('calc.visualEditor') : t('calc.advancedEditor')}
            </button>
          </div>
          {advanced ? (
            <textarea
              id="spec"
              rows={16}
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="rounded-[10px] border border-line-strong bg-surface p-3 font-mono text-[13px]"
            />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
                  {t('calc.name')}
                  <input
                    className={inputCls}
                    value={visualSpec.name}
                    onChange={(e) => updateSpec((current) => ({ ...current, name: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
                  {t('calc.description')}
                  <input
                    className={inputCls}
                    value={visualSpec.description ?? ''}
                    onChange={(e) =>
                      updateSpec((current) => ({
                        ...current,
                        description: e.target.value || undefined,
                      }))
                    }
                  />
                </label>
              </div>
              <section className="flex flex-col gap-3">
                <h3 className="m-0 text-base font-bold">{t('calc.inputs')}</h3>
                {visualSpec.inputs.map((input, index) => (
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
                            updateSpec((current) => ({
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
                    <button
                      type="button"
                      className={`${btn('danger', 'sm')} sm:col-span-2 lg:col-span-4 sm:justify-self-end`}
                      disabled={visualSpec.inputs.length === 1}
                      onClick={() =>
                        updateSpec((current) => ({
                          ...current,
                          inputs: current.inputs.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      {t('calc.removeInput')}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className={`${btn('secondary', 'sm')} self-start`}
                  onClick={() =>
                    updateSpec((current) => ({
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
                {Object.entries(visualSpec.constants ?? {}).map(([key, value]) => {
                  const metadata = visualSpec.constantMetadata?.[key]
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
                          updateSpec((current) => {
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
                {collidingConstant && (
                  <ErrorNote error={t('constants.keyConflict', { key: selectedConstant.key })} />
                )}
                {courseId && <ErrorNote error={courseConstants.error} />}
              </section>
              <section className="flex flex-col gap-3">
                <h3 className="m-0 text-base font-bold">{t('calc.results')}</h3>
                {visualSpec.outputs.map((output, index) => (
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
                            updateSpec((current) => ({
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
                    <button
                      type="button"
                      className={`${btn('danger', 'sm')} sm:col-span-2 sm:justify-self-end`}
                      disabled={visualSpec.outputs.length === 1}
                      onClick={() =>
                        updateSpec((current) => ({
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
                    updateSpec((current) => ({
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
          )}
          {parsed.error && <ErrorNote error={`${t('calc.invalid')}: ${parsed.error}`} />}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="calc-course" className="text-[13px] font-semibold text-muted">
              {t('calc.shareIn')}
            </label>
            <select
              id="calc-course"
              className={`${inputCls} max-w-xs`}
              value={courseId ?? ''}
              onChange={(e) => setCourseId(e.target.value || null)}
            >
              <option value="">{t('calc.onlyMe')}</option>
              {courses.data
                ?.filter((c) => c.role !== 'viewer')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <ErrorNote error={save.error} />
        </div>
      )}

      {calc && !editing && (
        <div className="flex flex-wrap items-center gap-4 border-t border-line bg-surface-2 px-6 py-5">
          <Eyebrow>{t('calc.export')}</Eyebrow>
          {(['json', 'py', 'html'] as const).map((f) => (
            <a
              key={f}
              href={api.calculators.exportUrl(calc.id, f)}
              className={`${btn('secondary', 'sm')} font-mono`}
            >
              .{f}
            </a>
          ))}
        </div>
      )}
    </section>
  )
}

export function Calculators() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { calcId?: string }
  const [filter, setFilter] = useState<'all' | 'ai'>('all')
  const [creating, setCreating] = useState(false)
  const list = useQuery({ queryKey: ['calculators'], queryFn: api.calculators.list })
  const importJson = useMutation({
    mutationFn: async (file: File) => {
      const { spec, error } = parseSpec(await file.text())
      if (!spec) throw new Error(`${t('calc.invalid')}: ${error}`)
      return api.calculators.create({ spec })
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['calculators'] })
      navigate({ to: '/calculators/$calcId', params: { calcId: c.id } })
    },
  })

  const shown = (list.data ?? []).filter((c) => filter === 'all' || c.origin === 'ai')
  const selected = list.data?.find((c) => c.id === params.calcId) ?? (creating ? null : (shown[0] ?? null))

  return (
    <div className="flex flex-col gap-7 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[40px] font-extrabold leading-[1.05] tracking-[-0.025em]">
            {t('calc.title')}
          </h1>
          <p className="m-0 text-base text-muted">{t('calc.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <label className={btn('secondary')}>
            {t('calc.import')}
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => e.target.files?.[0] && importJson.mutate(e.target.files[0])}
            />
          </label>
          <button
            type="button"
            className={btn('primary')}
            onClick={() => {
              setCreating(true)
              navigate({ to: '/calculators' })
            }}
          >
            {t('calc.new')}
          </button>
        </div>
      </header>
      <div role="tablist" aria-label={t('constants.tabs')} className="flex gap-2 border-b border-line">
        <Link
          to="/calculators"
          role="tab"
          aria-selected={true}
          className="border-b-2 border-ink px-3 py-2 text-sm font-bold text-ink no-underline"
        >
          {t('calc.title')}
        </Link>
        <Link
          to="/calculators/constants"
          role="tab"
          aria-selected={false}
          className="border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-muted no-underline"
        >
          {t('constants.title')}
        </Link>
      </div>
      <ErrorNote error={importJson.error} />

      <div className="flex flex-wrap items-start gap-7">
        <section aria-label={t('calc.title')} className="flex min-w-0 flex-[1_1_320px] flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {(['all', 'ai'] as const).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`min-h-9 cursor-pointer rounded-full border px-3.5 text-sm font-semibold ${filter === f ? 'border-inverse bg-inverse text-inverse-ink' : 'border-line-strong bg-surface text-ink'}`}
              >
                {f === 'all' ? t('calc.all') : t('calc.aiMade')}
              </button>
            ))}
          </div>
          {shown.length === 0 && !list.isPending && <Empty>{t('calc.empty')}</Empty>}
          {shown.map((c) => (
            <Link
              key={c.id}
              to="/calculators/$calcId"
              params={{ calcId: c.id }}
              onClick={() => setCreating(false)}
              aria-current={selected?.id === c.id ? 'true' : undefined}
              className={`flex flex-col items-start gap-1.5 rounded-[12px] bg-surface px-4.5 py-4 text-ink no-underline ${selected?.id === c.id ? 'border-2 border-accent' : 'border border-line'}`}
            >
              <span className="flex items-center gap-2 text-base font-bold">
                {c.name}
                {c.origin === 'ai' && (
                  <span className="rounded-[5px] bg-ai-soft px-1.5 py-0.5 text-[11px] font-semibold text-ai-text">
                    {t('calc.aiMade')}
                  </span>
                )}
              </span>
              <span className="font-mono text-[13px] text-accent">
                {c.spec.outputs.map((o) => o.key).join(', ')} = f({c.spec.inputs.map((i) => i.key).join(', ')}
                )
              </span>
              <span className="text-[13px] text-muted">{c.courseId ? '' : t('calc.personal')}</span>
            </Link>
          ))}
        </section>
        {(selected || creating) && (
          <Detail
            calc={creating && !params.calcId ? null : selected}
            isNew={creating && !params.calcId}
            onCancelNew={() => setCreating(false)}
          />
        )}
      </div>
    </div>
  )
}
