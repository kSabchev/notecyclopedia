import type { MathNode } from 'mathjs'
import { type CalculatorSpec, defaultInputs, evaluateCalculator } from './calculator'
import { limitedEvaluate, limitedParse, math } from './calculator-math'

/** Automatic checks of a calculator, without AI: units of each formula, unused inputs, constants given as inputs. */

/** Gravitational parameters (μ = GM) by key or label: physical constants, not values that change per problem. */
const GRAVITATIONAL_KEY = /^(mu|μ|gm)(_[a-z0-9]+)?$/i
const GRAVITATIONAL_LABEL = /gravitational parameter|\bGM\b/i

/** Whether an input is really a physical constant such as μ. */
export function isConstantInput(input: { key: string; label: string }): boolean {
  return GRAVITATIONAL_KEY.test(input.key) || GRAVITATIONAL_LABEL.test(input.label)
}

/**
 * The calculator with an input turned into a constant of the same key (so its formulas stay as they are), valued at
 * the input's default and described by its label and unit. Unchanged when the input has no default, or is the only
 * input (a calculator needs one).
 */
export function inputToConstant(spec: CalculatorSpec, key: string): CalculatorSpec {
  const input = spec.inputs.find((i) => i.key === key)
  if (!input || input.default === undefined || spec.inputs.length === 1) return spec
  const symbol = GRAVITATIONAL_KEY.test(key) && /^mu/i.test(key) ? `μ${key.slice(2)}` : key
  return {
    ...spec,
    inputs: spec.inputs.filter((i) => i.key !== key),
    constants: { ...spec.constants, [key]: input.default },
    ...(input.unit && {
      constantMetadata: {
        ...spec.constantMetadata,
        [key]: {
          name: input.label.slice(0, 120),
          symbol: symbol.slice(0, 32),
          unit: input.unit.slice(0, 40),
        },
      },
    }),
  }
}

/** A problem found without AI: a formula that fails, an unused value, or units that do not add up. */
export type CalculatorIssue =
  | { type: 'evaluation'; key?: string; message: string }
  | { type: 'unused'; key: string; label: string }
  /** An input that is a physical constant (such as μ): nobody changes it per problem, so it belongs in constants. */
  | { type: 'constant-input'; key: string; label: string }
  | {
      type: 'units'
      key: string
      label: string
      /** The output's unit as written; null when it has none. */
      expected: string | null
      /** What the formula gives, in SI units; null when it adds quantities of different kinds. */
      actual: string | null
    }

const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁻': '-',
}

/** math.js dimension index of angles; degrees and radians are treated as plain numbers. */
const ANGLE = 7

/**
 * A unit as math.js reads it, accepting common spellings: `km³/s²`, `km3/s2`, `m·s⁻¹`, `°`.
 * Undefined when there is no unit (a plain number), null when math.js does not know it (e.g. `AU`, `%`).
 */
export function parseUnit(text: string | undefined): math.Unit | null | undefined {
  if (!text?.trim()) return undefined
  const normalised = text
    .trim()
    .replace(/°/g, 'deg')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^${[...m].map((c) => SUPERSCRIPT[c]).join('')}`)
    .replace(/[·⋅]/g, ' ')
    .replace(/([A-Za-zµμ])(\d+)/g, '$1^$2')
  try {
    return math.unit(1, normalised)
  } catch {
    return null
  }
}

const dimensionless = (u: math.Unit) => u.dimensions.every((d, i) => i === ANGLE || Math.abs(d) < 1e-9)
const sameDimensions = (a: number[], b: number[]) =>
  a.every((d, i) => i === ANGLE || Math.abs(d - (b[i] ?? 0)) < 1e-9)
const NO_DIMENSIONS = Array<number>(9).fill(0)

/** The symbols a formula uses. */
function symbolsOf(expr: string): string[] {
  return limitedParse(expr)
    .filter((n: MathNode) => n.type === 'SymbolNode')
    .map((n: MathNode) => (n as MathNode & { name: string }).name)
}

/**
 * Checks that need no AI: every formula evaluates with the default values, every input and constant is used,
 * and each formula's units give the unit of its output. Inputs without a unit count as plain numbers, so a
 * physical constant written into a formula as a number shows up as a unit mismatch; formulas using a constant
 * without a stated unit, or a unit math.js does not know, are not unit-checked.
 */
export function checkCalculator(spec: CalculatorSpec): CalculatorIssue[] {
  const issues: CalculatorIssue[] = []
  const run = evaluateCalculator(spec, defaultInputs(spec))
  if (!run.ok) issues.push({ type: 'evaluation', key: run.key, message: run.error })

  const used = new Set(spec.outputs.flatMap((o) => symbolsOf(o.expr)))
  for (const input of spec.inputs)
    if (!used.has(input.key)) issues.push({ type: 'unused', key: input.key, label: input.label })
  for (const input of spec.inputs)
    if (isConstantInput(input)) issues.push({ type: 'constant-input', key: input.key, label: input.label })
  for (const key of Object.keys(spec.constants ?? {}))
    if (!used.has(key)) issues.push({ type: 'unused', key, label: spec.constantMetadata?.[key]?.name ?? key })

  // Units: evaluate again with every value carrying its unit. Values with an unknown unit, and everything
  // computed from them, are skipped rather than guessed.
  const scope = new Map<string, unknown>()
  const unknown = new Set<string>()
  const withUnit = (key: string, value: number, unitText: string | undefined) => {
    const unit = parseUnit(unitText)
    if (unit === null) unknown.add(key)
    else scope.set(key, unit === undefined || dimensionless(unit) ? value : math.multiply(value, unit))
  }
  // A constant without a stated unit (AI-made calculators often have none) is unknown, not a plain number.
  for (const [key, value] of Object.entries(spec.constants ?? {})) {
    const unit = spec.constantMetadata?.[key]?.unit
    if (unit) withUnit(key, value, unit)
    else unknown.add(key)
  }
  const defaults = defaultInputs(spec)
  for (const input of spec.inputs) withUnit(input.key, defaults[input.key] ?? 1, input.unit)

  for (const out of spec.outputs) {
    const declared = parseUnit(out.unit)
    if (declared === null || symbolsOf(out.expr).some((s) => unknown.has(s))) {
      unknown.add(out.key)
      continue
    }
    let value: unknown
    try {
      value = limitedEvaluate(out.expr, scope)
    } catch (e) {
      // Adding or comparing quantities of different kinds; other failures are not about units.
      if (/Units do not match/i.test((e as Error).message))
        issues.push({
          type: 'units',
          key: out.key,
          label: out.label,
          expected: out.unit ?? null,
          actual: null,
        })
      unknown.add(out.key)
      continue
    }
    const isUnit = math.isUnit(value)
    if (!isUnit && typeof value !== 'number') {
      unknown.add(out.key)
      continue
    }
    const actual = isUnit ? (value as math.Unit).dimensions : NO_DIMENSIONS
    const expected = declared === undefined ? NO_DIMENSIONS : declared.dimensions
    if (!sameDimensions(actual, expected))
      issues.push({
        type: 'units',
        key: out.key,
        label: out.label,
        expected: out.unit ?? null,
        actual:
          isUnit && !dimensionless(value as math.Unit) ? (value as math.Unit).toSI().formatUnits() : '1',
      })
    scope.set(out.key, value)
  }
  return issues
}
