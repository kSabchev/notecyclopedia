import { type CalculatorInput, type CalculatorSpec, evaluateCalculator } from './calculator'

/**
 * Practice problems from a calculator, with no AI: random inputs within each input's range give "a problem like this
 * one", and the calculator gives the exact answer and its steps. A problem is fixed by its seed, so the same seed
 * always gives the same numbers (for answer keys and for sharing a problem).
 */
export interface PracticeProblem {
  seed: number
  inputs: Record<string, number>
  /** Every output's exact value for these inputs. */
  values: Record<string, number>
}

/** A small, fast, seeded generator of numbers in [0, 1) (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The range practice values for an input are drawn from: its min and max, and where one is missing, half to double
 * its default (so calculators without ranges, including AI-made ones, work unchanged).
 */
export function practiceRange(input: CalculatorInput): { min: number; max: number } {
  const d = input.default ?? 1
  const around = d === 0 ? [-1, 1] : [Math.min(d / 2, d * 2), Math.max(d / 2, d * 2)]
  const min =
    input.min ?? (input.max !== undefined ? Math.min(around[0] as number, input.max) : (around[0] as number))
  let max = input.max ?? Math.max(around[1] as number, min)
  if (max <= min) max = min + Math.max(Math.abs(d), 1)
  return { min, max }
}

/** A practice value for an input: within its range, on its step when it has one, otherwise to 3 significant figures. */
export function practiceValue(input: CalculatorInput, random: () => number): number {
  const { min, max } = practiceRange(input)
  const raw = min + random() * (max - min)
  let value: number
  if (input.step) {
    const steps = Math.round((raw - min) / input.step)
    value = min + steps * input.step
    if (value > max) value -= input.step
  } else value = Number(raw.toPrecision(3))
  // Floating-point noise from the step arithmetic (0.1 + 0.2), and rounding past a bound.
  value = Number(value.toPrecision(12))
  return Math.min(max, Math.max(min, value))
}

/**
 * A problem like the calculator's default one, from `seed`: random inputs whose outputs all evaluate to finite
 * numbers. Inputs the calculator cannot evaluate (a square root of a negative number) are drawn again, up to 20
 * times; null when none work.
 */
export function practiceProblem(spec: CalculatorSpec, seed: number): PracticeProblem | null {
  for (let attempt = 0; attempt < 20; attempt++) {
    const random = seededRandom(seed + attempt * 0x9e3779b9)
    const inputs = Object.fromEntries(spec.inputs.map((input) => [input.key, practiceValue(input, random)]))
    const result = evaluateCalculator(spec, inputs)
    if (result.ok) return { seed, inputs, values: result.values }
  }
  return null
}

/** A new seed for a practice problem. */
export function newPracticeSeed(): number {
  const buffer = new Uint32Array(1)
  globalThis.crypto.getRandomValues(buffer)
  return buffer[0] as number
}

/** A number as a student types it: spaces ignored, and a decimal comma accepted ("2,43"). NaN when it is not one. */
export function parseAnswer(text: string): number {
  const cleaned = text.replace(/[\s  ]/g, '')
  const decimal = cleaned.includes('.') ? cleaned : cleaned.replace(',', '.')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(decimal)) return Number.NaN
  return Number(decimal)
}

/**
 * Whether an answer matches the exact value: within 1%, so a student who rounded intermediate values is not marked
 * wrong, or within half the last decimal shown for values near zero.
 */
export function answerMatches(given: number, exact: number, precision = 3): boolean {
  if (!Number.isFinite(given)) return false
  const tolerance = Math.max(Math.abs(exact) * 0.01, 0.5 * 10 ** -precision)
  return Math.abs(given - exact) <= tolerance
}
