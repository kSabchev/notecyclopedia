import { describe, expect, it } from 'vitest'
import {
  type CalculatorSpec,
  calculationSteps,
  calculatorSpecSchema,
  compileExcel,
  exportHTML,
  exportPython,
  substitutionParts,
} from './calculator'
import { calculatorWorkbook } from './calculator-xlsx'

const projectile: CalculatorSpec = {
  version: 1,
  name: 'Projectile motion',
  theory:
    'A projectile moves with constant horizontal speed and constant downward acceleration g.\n\nIgnoring air drag, the flight is symmetric.',
  inputs: [
    { key: 'v0', label: 'Initial speed', unit: 'm/s', default: 20 },
    { key: 'theta', label: 'Angle', unit: 'deg', default: 30 },
    { key: 'g', label: 'Gravity', unit: 'm/s²', default: 9.81 },
  ],
  outputs: [
    {
      key: 'T',
      label: 'Flight time',
      unit: 's',
      expr: '2 * v0 * sin(theta deg) / g',
      explanation: 'The vertical speed reverses in v0·sinθ/g, so the full flight takes twice that.',
    },
    { key: 'R', label: 'Range', unit: 'm', expr: 'v0 * cos(theta deg) * T' },
  ],
}

describe('step-by-step solution', () => {
  it('accepts theory and explanations in the calculator format', () => {
    expect(calculatorSpecSchema.safeParse(projectile).success).toBe(true)
  })

  it('marks inputs, earlier results and degree inputs for substitution', () => {
    const parts = substitutionParts('v0 * cos(theta deg) * T', new Set(['v0', 'theta', 'T']))
    expect(parts).toEqual([
      { key: 'v0', deg: false },
      ' * cos(',
      { key: 'theta', deg: true },
      ') * ',
      { key: 'T', deg: false },
    ])
  })

  it('fills in values with units and shows each result', () => {
    const [time, range] = calculationSteps(projectile, { v0: 20, theta: 30, g: 9.81 })
    expect(time).toMatchObject({
      label: 'Flight time',
      formula: 'T = 2 * v0 * sin(theta deg) / g',
      substituted: '2 * (20 m/s) * sin(30°) / (9.81 m/s²)',
      explanation: projectile.outputs[0]?.explanation,
    })
    expect(time?.value).toBeCloseTo(2.0387, 4)
    // Earlier results are substituted with their own unit and precision.
    expect(range?.substituted).toBe('(20 m/s) * cos(30°) * (2.039 s)')
  })

  it('puts negative values in parentheses', () => {
    const spec: CalculatorSpec = {
      version: 1,
      name: 'Difference',
      inputs: [
        { key: 'a', label: 'a', default: 5 },
        { key: 'b', label: 'b', default: -3 },
      ],
      outputs: [{ key: 'd', label: 'Difference', expr: 'a - b' }],
    }
    expect(calculationSteps(spec, { a: 5, b: -3 })[0]?.substituted).toBe('5 - (-3)')
  })

  it('leaves a step without values when an input is missing', () => {
    const [time] = calculationSteps(projectile, { v0: Number.NaN, theta: 30, g: 9.81 })
    expect(time?.value).toBeNull()
    expect(time?.substituted).toBeNull()
  })
})

describe('Excel formulas', () => {
  const ref = (key: string) => ({ y: 'B2', x: 'B3', a: 'B4' })[key]

  it('swaps atan2 arguments, as Excel takes x first', () => {
    expect(compileExcel('atan2(y, x)', ref)).toBe('ATAN2(B3,B2)')
  })

  it('translates operators and functions Excel spells differently', () => {
    expect(compileExcel('x % 3', ref)).toBe('MOD(B3,3)')
    expect(compileExcel('log(x)', ref)).toBe('LN(B3)')
    expect(compileExcel('log(x, 2)', ref)).toBe('LOG(B3,2)')
    expect(compileExcel('x > 0 and y > 0 ? 1 : 0', ref)).toBe('IF(AND((B3>0),(B2>0)),1,0)')
    expect(compileExcel('x != y', ref)).toBe('(B3<>B2)')
    expect(compileExcel('sin(a deg) * pi', ref)).toBe('(SIN((B4*(PI()/180)))*PI())')
  })

  it('keeps math precedence where Excel differs (-x^2)', () => {
    // math.js reads -x^2 as -(x^2); Excel would read -B3^2 as (-B3)^2.
    expect(compileExcel('-x^2', ref)).toBe('(-(B3^2))')
  })

  it('rejects unknown names', () => {
    expect(() => compileExcel('q + 1', ref)).toThrow('Unknown symbol "q"')
  })
})

describe('Excel workbook', () => {
  const files = calculatorWorkbook({ ...projectile, name: 'Range & time <v1>' })
  const sheet = files.find((f) => f.path === 'xl/worksheets/sheet1.xml')?.content ?? ''

  it('has the parts Excel needs, with the theory on its own sheet', () => {
    expect(files.map((f) => f.path)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ])
    expect(files.find((f) => f.path === 'xl/workbook.xml')?.content).toContain('<sheet name="Theory"')
    expect(files.find((f) => f.path === 'xl/worksheets/sheet2.xml')?.content).toContain(
      'Ignoring air drag, the flight is symmetric.',
    )
  })

  it('writes results as formulas over the input cells, with cached values', () => {
    // Title, blank row and header first, so the inputs are on rows 4-6 and the results on rows 9-10.
    expect(sheet).toContain('<c r="B4" s="2"><v>20</v></c>')
    expect(sheet).toContain('<c r="B9"><f>(((2*$B$4)*SIN(($B$5*(PI()/180))))/$B$6)</f><v>2.03')
    // A later step refers to the cell of an earlier result.
    expect(sheet).toContain('<f>(($B$4*COS(($B$5*(PI()/180))))*$B$9)</f>')
    expect(sheet).toContain('The vertical speed reverses')
  })

  it('escapes text for XML', () => {
    expect(sheet).toContain('Range &amp; time &lt;v1&gt;')
  })
})

describe('HTML and Python exports', () => {
  it('include the theory and a live step-by-step solution', () => {
    const html = exportHTML(projectile)
    expect(html).toContain('<h2>Theory</h2>')
    expect(html).toContain('<p>Ignoring air drag, the flight is symmetric.</p>')
    expect(html).toContain('<h2>Step-by-step solution</h2>')
    expect(html).toContain('id="sub_T"')
    expect(html).toContain('The vertical speed reverses')
  })

  it('cannot be broken out of by text in the calculator', () => {
    const html = exportHTML({ ...projectile, outputs: [{ key: 'T', label: '</script><b>x', expr: 'v0' }] })
    expect(html).not.toContain('</script><b>')
  })

  it('carry the theory and explanations into Python', () => {
    const py = exportPython(projectile)
    expect(py).toContain('Ignoring air drag, the flight is symmetric.')
    expect(py).toContain('    # The vertical speed reverses')
  })
})
