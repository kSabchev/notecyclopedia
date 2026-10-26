import { describe, expect, it } from 'vitest'
import { calculatorSpecSchema, evaluateCalculator, exportHTML, exportPython } from './calculator'
import { BUILT_IN_CONSTANTS } from './constants'
import { chunkText, docToText, extractFormulas } from './doc'

const projectile = calculatorSpecSchema.parse({
  name: 'Projectile motion',
  inputs: [
    { key: 'v0', label: 'Initial speed', unit: 'm/s', default: 20 },
    { key: 'theta', label: 'Angle', unit: 'deg', default: 30 },
    { key: 'g', label: 'Gravity', unit: 'm/s²', default: 9.81 },
  ],
  outputs: [
    { key: 'T', label: 'Flight time', unit: 's', expr: '2 * v0 * sin(theta deg) / g' },
    { key: 'H', label: 'Max height', unit: 'm', expr: 'v0^2 * sin(theta deg)^2 / (2 * g)' },
    { key: 'R', label: 'Range', unit: 'm', expr: 'v0 * cos(theta deg) * T' },
  ],
})

describe('evaluateCalculator', () => {
  it('computes projectile values with degrees and chained outputs', () => {
    const r = evaluateCalculator(projectile, { v0: 20, theta: 30, g: 9.81 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.values.T).toBeCloseTo(2.0387, 3)
    expect(r.values.H).toBeCloseTo(5.0968, 3)
    expect(r.values.R).toBeCloseTo(35.31, 1)
  })

  it('blocks dangerous functions', () => {
    const bad = { ...projectile, outputs: [{ key: 'x', label: 'x', expr: 'evaluate("1+1")' }] }
    const r = evaluateCalculator(bad, { v0: 1, theta: 1, g: 1 })
    expect(r.ok).toBe(false)
  })

  it('rejects duplicate keys', () => {
    const res = calculatorSpecSchema.safeParse({
      ...projectile,
      outputs: [{ key: 'v0', label: 'a', expr: '1' }],
    })
    expect(res.success).toBe(false)
  })

  it('uses a built-in constant by its key and preserves its unit metadata', () => {
    const speedOfLight = BUILT_IN_CONSTANTS.find((constant) => constant.key === 'C_LIGHT')
    expect(speedOfLight).toBeDefined()
    if (!speedOfLight) return
    const spec = calculatorSpecSchema.parse({
      name: 'Light travel',
      inputs: [{ key: 'distance', label: 'Distance', unit: 'm', default: speedOfLight.value }],
      constants: { [speedOfLight.key]: speedOfLight.value },
      constantMetadata: {
        [speedOfLight.key]: {
          name: speedOfLight.name,
          symbol: speedOfLight.symbol,
          unit: speedOfLight.unit,
        },
      },
      outputs: [{ key: 'time', label: 'Travel time', unit: 's', expr: `distance / ${speedOfLight.key}` }],
    })

    expect(spec.constantMetadata?.C_LIGHT?.unit).toBe('m/s')
    const result = evaluateCalculator(spec, { distance: speedOfLight.value * 2 })
    expect(result).toEqual({ ok: true, values: { time: 2 } })
  })
})

describe('exporters', () => {
  it('produces python with math module', () => {
    const py = exportPython(projectile)
    expect(py).toContain('import math')
    expect(py).toContain('math.sin')
    expect(py).toContain('**')
  })

  it('produces a working html widget', () => {
    const html = exportHTML(projectile)
    const script = html.split('<script>')[1]!.split('function run')[0]!
    const calc = new Function(`${script}; return calc;`)() as (...a: number[]) => Record<string, number>
    expect(calc(20, 30, 9.81).R).toBeCloseTo(35.31, 1)
  })
})

describe('doc helpers', () => {
  const doc = {
    type: 'doc' as const,
    content: [
      { type: 'heading', content: [{ type: 'text', text: 'Motion' }] },
      { type: 'formula', attrs: { latex: 'v = v_0 + at', label: '4.1', pinned: true } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Ускорение.' }] },
    ],
  }
  it('extracts text and formulas', () => {
    expect(docToText(doc)).toContain('$v = v_0 + at$')
    expect(docToText(doc)).toContain('Ускорение.')
    expect(extractFormulas(doc)).toEqual([
      { latex: 'v = v_0 + at', label: '4.1', description: null, pinned: true },
    ])
  })
  it('chunks long text', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} `.repeat(20)).join('\n\n')
    const chunks = chunkText(text, 1000, 100)
    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks.every((c) => c.length <= 1100)).toBe(true)
  })
})
