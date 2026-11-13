import type { CalculatorSpec } from './calculator'

/** Comparing two versions of a calculator, field by field, to show what a review or rework changes. */

/** One difference between two versions of a calculator, for showing proposed corrections. */
export interface SpecChange {
  area: 'calculator' | 'input' | 'output' | 'constant'
  /** The input, output or constant key; the field name for the calculator itself. */
  key: string
  /** The changed field, or 'added' / 'removed'. */
  field: string
  before: string | null
  after: string | null
}

const shown = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v))

/** What changed between two versions: added and removed items, and every changed field, in spec order. */
export function diffSpecs(before: CalculatorSpec, after: CalculatorSpec): SpecChange[] {
  const changes: SpecChange[] = []
  for (const field of ['name', 'description', 'theory'] as const)
    if (shown(before[field]) !== shown(after[field]))
      changes.push({
        area: 'calculator',
        key: field,
        field,
        before: shown(before[field]),
        after: shown(after[field]),
      })

  const compare = <T extends { key: string }>(
    area: 'input' | 'output',
    a: T[],
    b: T[],
    fields: (keyof T & string)[],
    summary: (item: T) => string,
  ) => {
    for (const item of a)
      if (!b.some((x) => x.key === item.key))
        changes.push({ area, key: item.key, field: 'removed', before: summary(item), after: null })
    for (const item of b) {
      const old = a.find((x) => x.key === item.key)
      if (!old) {
        changes.push({ area, key: item.key, field: 'added', before: null, after: summary(item) })
        continue
      }
      for (const field of fields)
        if (shown(old[field]) !== shown(item[field]))
          changes.push({ area, key: item.key, field, before: shown(old[field]), after: shown(item[field]) })
    }
  }
  compare('input', before.inputs, after.inputs, ['label', 'unit', 'default', 'min', 'max', 'step'], (i) =>
    [i.label, i.unit && `[${i.unit}]`, i.default !== undefined && `= ${i.default}`].filter(Boolean).join(' '),
  )
  compare(
    'output',
    before.outputs,
    after.outputs,
    ['label', 'unit', 'expr', 'precision', 'explanation'],
    (o) => `${o.key} = ${o.expr}${o.unit ? ` [${o.unit}]` : ''}`,
  )
  const constantsBefore = before.constants ?? {}
  const constantsAfter = after.constants ?? {}
  for (const key of new Set([...Object.keys(constantsBefore), ...Object.keys(constantsAfter)]))
    if (constantsBefore[key] !== constantsAfter[key])
      changes.push({
        area: 'constant',
        key,
        field: key in constantsAfter ? (key in constantsBefore ? 'value' : 'added') : 'removed',
        before: shown(constantsBefore[key]),
        after: shown(constantsAfter[key]),
      })
  for (const key of Object.keys(constantsAfter)) {
    const unitBefore = shown(before.constantMetadata?.[key]?.unit)
    const unitAfter = shown(after.constantMetadata?.[key]?.unit)
    if (key in constantsBefore && unitBefore !== unitAfter)
      changes.push({ area: 'constant', key, field: 'unit', before: unitBefore, after: unitAfter })
  }
  return changes
}
