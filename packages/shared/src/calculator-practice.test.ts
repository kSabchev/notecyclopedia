import { describe, expect, it } from 'vitest'
import { type CalculatorSpec, evaluateCalculator } from './calculator'
import {
  answerMatches,
  parseAnswer,
  practiceProblem,
  practiceRange,
  practiceValue,
  seededRandom,
} from './calculator-practice'
import { HOHMANN_CALCULATOR } from './orbit'

describe('practice ranges and values', () => {
  it('uses an input’s min and max, and half to double its default where one is missing', () => {
    expect(practiceRange({ key: 'a', label: 'A', default: 10, min: 1, max: 5 })).toEqual({ min: 1, max: 5 })
    expect(practiceRange({ key: 'a', label: 'A', default: 10 })).toEqual({ min: 5, max: 20 })
    expect(practiceRange({ key: 'a', label: 'A', default: 10, min: 8 })).toEqual({ min: 8, max: 20 })
    expect(practiceRange({ key: 'a', label: 'A', default: 10, max: 12 })).toEqual({ min: 5, max: 12 })
    expect(practiceRange({ key: 'a', label: 'A', default: -4 })).toEqual({ min: -8, max: -2 })
    expect(practiceRange({ key: 'a', label: 'A', default: 0 })).toEqual({ min: -1, max: 1 })
    expect(practiceRange({ key: 'a', label: 'A' })).toEqual({ min: 0.5, max: 2 })
    // A min above double the default still gives a range.
    expect(practiceRange({ key: 'a', label: 'A', default: 1, min: 50 })).toEqual({ min: 50, max: 51 })
  })

  it('draws values within the range, on the step when there is one, otherwise to 3 significant figures', () => {
    const random = seededRandom(7)
    for (let i = 0; i < 200; i++) {
      const stepped = practiceValue({ key: 'n', label: 'N', min: 1, max: 10, step: 0.5 }, random)
      expect(stepped).toBeGreaterThanOrEqual(1)
      expect(stepped).toBeLessThanOrEqual(10)
      expect((stepped * 2) % 1).toBe(0)
      const free = practiceValue({ key: 'r', label: 'R', default: 6678 }, random)
      expect(free).toBeGreaterThanOrEqual(3339)
      expect(free).toBeLessThanOrEqual(13356)
      expect(Number(free.toPrecision(3))).toBe(free)
    }
  })
})

describe('practiceProblem', () => {
  it('gives the same problem for the same seed, with the calculator’s exact answers', () => {
    const a = practiceProblem(HOHMANN_CALCULATOR, 42)
    const b = practiceProblem(HOHMANN_CALCULATOR, 42)
    expect(a).toEqual(b)
    expect(a?.inputs).not.toEqual(practiceProblem(HOHMANN_CALCULATOR, 43)?.inputs)
    const exact = evaluateCalculator(HOHMANN_CALCULATOR, a?.inputs ?? {})
    expect(exact.ok && exact.values).toEqual(a?.values)
  })

  it('draws again when the numbers cannot be evaluated, and gives up when none can', () => {
    const sqrt: CalculatorSpec = {
      version: 1,
      name: 'Root',
      inputs: [{ key: 'x', label: 'x', default: 0 }],
      outputs: [{ key: 'y', label: 'y', expr: 'sqrt(x)', precision: 3 }],
    }
    // x is drawn from −1 to 1; a negative x gives a complex root, which is not a number.
    const problem = practiceProblem(sqrt, 1)
    expect(problem?.inputs.x).toBeGreaterThanOrEqual(0)
    const never: CalculatorSpec = {
      ...sqrt,
      inputs: [{ key: 'x', label: 'x', min: -2, max: -1 }],
      outputs: [{ key: 'y', label: 'y', expr: '1 / (x - x)' }],
    }
    expect(practiceProblem(never, 1)).toBeNull()
  })
})

describe('answers', () => {
  it('reads numbers as students type them', () => {
    expect(parseAnswer('2.43')).toBe(2.43)
    expect(parseAnswer(' 2,43 ')).toBe(2.43)
    expect(parseAnswer('42 164')).toBe(42164)
    expect(parseAnswer('-1.5e3')).toBe(-1500)
    expect(parseAnswer('1,234.5')).toBe(Number.NaN)
    expect(parseAnswer('abc')).toBe(Number.NaN)
    expect(parseAnswer('')).toBe(Number.NaN)
  })

  it('accepts an answer within 1%, or within half the last decimal near zero', () => {
    expect(answerMatches(2.43, 2.4257)).toBe(true)
    expect(answerMatches(2.4, 2.4257)).toBe(false)
    expect(answerMatches(0.0004, 0, 3)).toBe(true)
    expect(answerMatches(0.002, 0, 3)).toBe(false)
    expect(answerMatches(Number.NaN, 1)).toBe(false)
  })
})
