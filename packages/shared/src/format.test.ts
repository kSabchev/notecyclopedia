import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fileSlug, formatFixed, formatValue, issuesText } from './format'

describe('formatValue', () => {
  it('drops trailing zeros and uses exponents for very large or small numbers', () => {
    expect(formatValue(7.546)).toBe('7.546')
    expect(formatValue(2.5, 3)).toBe('2.5')
    expect(formatValue(0)).toBe('0')
    expect(formatValue(3e8)).toBe('3.000e+8')
    expect(formatValue(1.2e-5, 2)).toBe('1.20e-5')
  })
})

describe('formatFixed', () => {
  it('keeps the decimals and never shows a negative zero', () => {
    expect(formatFixed(0.00041, 4)).toBe('0.0004')
    expect(formatFixed(-0.00001, 4)).toBe('0.0000')
    expect(formatFixed(-1.5, 1)).toBe('-1.5')
  })
})

describe('issuesText', () => {
  it('lists what is wrong, with paths, up to a limit', () => {
    const schema = z.object({ a: z.number(), b: z.object({ c: z.string() }), d: z.boolean(), e: z.number() })
    const error = schema.safeParse({ a: 'x', b: { c: 1 }, d: 1, e: 'y' }).error
    if (!error) throw new Error('expected an error')
    expect(issuesText(error, 2)).toBe(
      'a: Expected number, received string; b.c: Expected string, received number',
    )
    expect(issuesText(error).split('; ')).toHaveLength(4)
  })

  it('leaves out an empty path', () => {
    const error = z.string().safeParse(1).error
    if (!error) throw new Error('expected an error')
    expect(issuesText(error)).toBe('Expected string, received number')
  })
})

describe('fileSlug', () => {
  it('keeps letters in any script and digits, joined by dashes', () => {
    expect(fileSlug('Transfers exam (v2)!', 'plan')).toBe('Transfers-exam-v2')
    expect(fileSlug('Хоман преход', 'plan')).toBe('Хоман-преход')
  })

  it('falls back when nothing is left, and stays short without a dangling dash', () => {
    expect(fileSlug('!!!', 'plan')).toBe('plan')
    expect(fileSlug('abc def', 'x', 4)).toBe('abc')
  })
})
