import type { MathNode } from 'mathjs'
import { type CalculatorSpec, evaluateCalculator } from './calculator'
import { limitedParse } from './calculator-math'
import { formatValue } from './format'

/** The step-by-step solution: each output with its formula, the values substituted, and the result. */

/** A piece of a formula with values filled in: text, or the value of a key (`deg`: an angle given in degrees). */
export type SubstitutionPart = string | { key: string; deg: boolean }

/**
 * The expression with every input, constant and earlier output marked for substitution, e.g.
 * `sqrt(mu / r)` → ['sqrt(', {key: 'mu'}, ' / ', {key: 'r'}, ')']. `theta deg` becomes one part with `deg`.
 */
export function substitutionParts(expr: string, known: Set<string>): SubstitutionPart[] {
  const open = ''
  const close = ''
  const text = limitedParse(expr).toString({
    handler: (node: MathNode) => {
      const n = node as MathNode & Record<string, unknown>
      if (node.type === 'SymbolNode' && known.has(n.name as string)) return `${open}${n.name}${close}`
      // `theta deg`: an input in degrees, shown as "30°".
      const args = n.args as MathNode[] | undefined
      if (
        node.type === 'OperatorNode' &&
        n.implicit &&
        args?.length === 2 &&
        args[0]?.type === 'SymbolNode' &&
        known.has((args[0] as MathNode & { name: string }).name) &&
        args[1]?.type === 'SymbolNode' &&
        (args[1] as MathNode & { name: string }).name === 'deg'
      )
        return `${open}${(args[0] as MathNode & { name: string }).name}°${close}`
      return undefined
    },
  })
  const parts: SubstitutionPart[] = []
  for (const [k, piece] of text.split(new RegExp(`[${open}${close}]`)).entries()) {
    if (k % 2 === 0) {
      if (piece) parts.push(piece)
    } else parts.push({ key: piece.replace(/°$/, ''), deg: piece.endsWith('°') })
  }
  return parts
}

/** A value as it appears in a substituted formula: negative values in parentheses, units kept. */
export function substitutedValue(value: number, precision: number, unit?: string, deg = false): string {
  const text = deg ? `${formatValue(value, precision)}°` : formatValue(value, precision)
  const withUnit = unit && !deg ? `${text} ${unit}` : text
  return value < 0 || (unit && !deg) ? `(${withUnit})` : withUnit
}

export interface CalculationStep {
  key: string
  label: string
  unit?: string
  explanation?: string
  /** The formula as written, e.g. `T = 2 * pi * sqrt(a^3 / mu)`. */
  formula: string
  /** The formula with the current values filled in; null when an earlier step failed. */
  substituted: string | null
  value: number | null
}

/** Each output as a step: what is computed, from which formula, with which values, and the result. */
export function calculationSteps(spec: CalculatorSpec, inputs: Record<string, number>): CalculationStep[] {
  const result = evaluateCalculator(spec, inputs)
  const known = new Set([...spec.inputs.map((i) => i.key), ...Object.keys(spec.constants ?? {})])
  const values = new Map<string, number>(Object.entries(spec.constants ?? {}))
  const units = new Map<string, string | undefined>()
  const precisions = new Map<string, number>()
  for (const inp of spec.inputs) {
    const v = inputs[inp.key] ?? inp.default
    if (v !== undefined && !Number.isNaN(v)) values.set(inp.key, v)
    units.set(inp.key, inp.unit)
  }
  for (const [key, meta] of Object.entries(spec.constantMetadata ?? {})) units.set(key, meta.unit)
  const steps: CalculationStep[] = []
  for (const out of spec.outputs) {
    const value = result.ok ? (result.values[out.key] ?? null) : null
    const parts = substitutionParts(out.expr, known)
    const ready = parts.every((p) => typeof p === 'string' || values.has(p.key))
    steps.push({
      key: out.key,
      label: out.label,
      unit: out.unit,
      explanation: out.explanation,
      formula: `${out.key} = ${out.expr}`,
      substituted: ready
        ? parts
            .map((p) =>
              typeof p === 'string'
                ? p
                : substitutedValue(
                    values.get(p.key) as number,
                    precisions.get(p.key) ?? 4,
                    units.get(p.key),
                    p.deg,
                  ),
            )
            .join('')
        : null,
      value,
    })
    known.add(out.key)
    units.set(out.key, out.unit)
    precisions.set(out.key, out.precision ?? 3)
    if (value !== null) values.set(out.key, value)
  }
  return steps
}
