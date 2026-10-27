import { describe, expect, it } from 'vitest'
import { calculatorSpecSchema, evaluateCalculator, exportHTML, exportPython } from './calculator'
import { BUILT_IN_CONSTANTS } from './constants'
import { chunkText, docToText, extractFormulas, withFormulaIds } from './doc'

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

  it('exports sign expressions to Python and HTML', () => {
    const signCalculator = calculatorSpecSchema.parse({
      name: 'Sign',
      inputs: [{ key: 'x', label: 'Value', default: 1 }],
      outputs: [{ key: 'result', label: 'Sign', expr: 'sign(x)' }],
    })
    const py = exportPython(signCalculator)
    expect(py).toContain('result = (1 if x > 0 else (-1 if x < 0 else 0))')

    const html = exportHTML(signCalculator)
    const script = html.split('<script>')[1]!.split('function run')[0]!
    const calc = new Function(`${script}; return calc;`)() as (x: number) => Record<string, number>
    expect(calc(5).result).toBe(1)
    expect(calc(-5).result).toBe(-1)
    expect(calc(0).result).toBe(0)
  })

  it('exports comparisons, boolean operators, and nested conditionals to both targets', () => {
    const conditionalCalculator = calculatorSpecSchema.parse({
      name: 'Conditional calculation',
      inputs: [
        { key: 'x', label: 'X', default: 5 },
        { key: 'y', label: 'Y', default: 2 },
      ],
      outputs: [
        {
          key: 'result',
          label: 'Result',
          expr: 'x > 0 and y != 0 ? (x > y ? sign(x) : -sign(y)) : (x == 0 or y == 0 ? 0 : sign(x + y))',
        },
        { key: 'logarithm', label: 'Logarithm', expr: 'log(8, 2)' },
        { key: 'rounded', label: 'Rounded', expr: 'round(-1.25, 1)' },
      ],
    })

    const py = exportPython(conditionalCalculator)
    expect(py).toContain(' and ')
    expect(py).toContain(' if ')
    expect(py).toContain(' else ')
    expect(py).toContain('math.log(8, 2)')
    expect(py).toContain('math.copysign')

    const html = exportHTML(conditionalCalculator)
    const script = html.split('<script>')[1]!.split('function run')[0]!
    const calc = new Function(`${script}; return calc;`)() as (x: number, y: number) => Record<string, number>
    expect(calc(5, 2).result).toBe(1)
    expect(calc(1, 2).result).toBe(-1)
    expect(calc(0, 2).result).toBe(0)
    expect(calc(-3, 2).result).toBe(-1)
    expect(calc(5, 2).logarithm).toBeCloseTo(3)
    expect(calc(5, 2).rounded).toBeCloseTo(-1.3)
  })

  it('rejects expressions outside the portable formula subset during validation', () => {
    const result = calculatorSpecSchema.safeParse({
      name: 'Unsupported function',
      inputs: [{ key: 'x', label: 'X' }],
      outputs: [{ key: 'result', label: 'Result', expr: 'if(x > 0, 1, 0)' }],
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path).toEqual(['outputs', 0, 'expr'])
    expect(result.error.issues[0]?.message).toContain('Function "if" is not supported in export')
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
      { nodeId: null, latex: 'v = v_0 + at', label: '4.1', description: null, pinned: true },
    ])
  })
  it('assigns missing and duplicate formula ids, keeping existing ones', () => {
    const formula = (id?: string) => ({ type: 'formula', attrs: { latex: 'x', ...(id ? { id } : {}) } })
    const input = {
      type: 'doc' as const,
      content: [
        formula('keep'),
        formula('keep'),
        { type: 'blockquote', content: [formula()] },
        { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
      ],
    }
    let n = 0
    const { doc: out, changed } = withFormulaIds(input, () => `new-${++n}`)
    expect(changed).toBe(true)
    expect(extractFormulas(out).map((f) => f.nodeId)).toEqual(['keep', 'new-1', 'new-2'])
    expect(out.content?.[3]).toBe(input.content[3])
    expect(withFormulaIds(out)).toEqual({ doc: out, changed: false })
  })
  it('chunks long text', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} `.repeat(20)).join('\n\n')
    const chunks = chunkText(text, 1000, 100)
    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks.every((c) => c.length <= 1100)).toBe(true)
  })
})
