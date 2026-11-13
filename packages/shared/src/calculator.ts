import { z } from 'zod'
import { compileExpr } from './calculator-code'
import { limitedEvaluate, math } from './calculator-math'

/**
 * A calculator is a small, portable definition: named inputs (with units for display),
 * and outputs given as math.js expressions over the inputs and earlier outputs.
 *
 * Angles: write `theta deg` in an expression to treat an input as degrees, e.g. `sin(theta deg)`.
 */

const key = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Use letters, digits and _ (start with a letter)')
  .max(32)

export const calculatorInputSchema = z.object({
  key,
  label: z.string().min(1).max(80),
  unit: z.string().max(24).optional(),
  default: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
})

export const calculatorOutputSchema = z.object({
  key,
  label: z.string().min(1).max(80),
  unit: z.string().max(24).optional(),
  expr: z.string().min(1).max(500),
  precision: z.number().int().min(0).max(12).optional(),
  /** Why this step is done, shown in the step-by-step solution. */
  explanation: z.string().max(1000).optional(),
})

const calculatorConstantMetadataSchema = z.object({
  name: z.string().min(1).max(120),
  symbol: z.string().min(1).max(32),
  unit: z.string().min(1).max(40),
})

export const calculatorSpecSchema = z
  .object({
    version: z.literal(1).default(1),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    /** The theory behind the calculation: paragraphs separated by blank lines. */
    theory: z.string().max(8000).optional(),
    inputs: z.array(calculatorInputSchema).min(1).max(30),
    outputs: z.array(calculatorOutputSchema).min(1).max(30),
    constants: z.record(key, z.number()).optional(),
    constantMetadata: z.record(key, calculatorConstantMetadataSchema).optional(),
  })
  .superRefine((spec, ctx) => {
    const keys = [...spec.inputs.map((input) => input.key), ...Object.keys(spec.constants ?? {})]
    const seen = new Set<string>()
    for (const key of keys) {
      if (seen.has(key)) ctx.addIssue({ code: 'custom', message: `Duplicate key "${key}"` })
      seen.add(key)
    }
    const known = new Set(seen)
    for (const [index, output] of spec.outputs.entries()) {
      if (seen.has(output.key))
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate key "${output.key}"`,
          path: ['outputs', index, 'key'],
        })
      seen.add(output.key)

      try {
        compileExpr(output.expr, 'py', known)
        compileExpr(output.expr, 'js', known)
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          message: (error as Error).message,
          path: ['outputs', index, 'expr'],
        })
      }
      known.add(output.key)
    }
  })

export type CalculatorInput = z.infer<typeof calculatorInputSchema>
export type CalculatorOutput = z.infer<typeof calculatorOutputSchema>
export type CalculatorSpec = z.infer<typeof calculatorSpecSchema>

export type CalcResult =
  | { ok: true; values: Record<string, number> }
  | { ok: false; error: string; key?: string }

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (math.isUnit(v)) return (v as math.Unit).toNumber()
  if (math.isBigNumber(v) || math.isFraction(v)) return math.number(v as never) as number
  throw new Error('Expression did not produce a number')
}

/** Evaluate all outputs in order. Each output can use inputs, constants and earlier outputs. */
export function evaluateCalculator(spec: CalculatorSpec, inputs: Record<string, number>): CalcResult {
  const scope = new Map<string, unknown>()
  for (const [k, v] of Object.entries(spec.constants ?? {})) scope.set(k, v)
  for (const inp of spec.inputs) {
    const v = inputs[inp.key] ?? inp.default
    if (v === undefined || Number.isNaN(v))
      return { ok: false, error: `Missing value for ${inp.label}`, key: inp.key }
    scope.set(inp.key, v)
  }
  const values: Record<string, number> = {}
  for (const out of spec.outputs) {
    try {
      const n = toNumber(limitedEvaluate(out.expr, scope))
      if (!Number.isFinite(n)) return { ok: false, error: `${out.label} is not finite`, key: out.key }
      values[out.key] = n
      scope.set(out.key, n)
    } catch (e) {
      return { ok: false, error: `${out.label}: ${(e as Error).message}`, key: out.key }
    }
  }
  return { ok: true, values }
}

/** Default values for every input (falls back to 1). */
export function defaultInputs(spec: CalculatorSpec): Record<string, number> {
  return Object.fromEntries(spec.inputs.map((i) => [i.key, i.default ?? 1]))
}

export { formatValue } from './format'
