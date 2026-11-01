import { describe, expect, it } from 'vitest'
import { type CalculatorSpec, checkCalculator, diffSpecs, parseUnit } from './calculator'

const orbit: CalculatorSpec = {
  version: 1,
  name: 'Circular orbit',
  inputs: [
    { key: 'r', label: 'Radius', unit: 'km', default: 7000 },
    { key: 'mu', label: 'Gravitational parameter', unit: 'km³/s²', default: 398600 },
  ],
  outputs: [
    { key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / r)' },
    { key: 'T', label: 'Period', unit: 's', expr: '2 * pi * r / v' },
  ],
}

describe('parseUnit', () => {
  it('reads superscripts, plain exponents and degrees', () => {
    for (const text of ['km³/s²', 'km3/s2', 'km^3/s^2', 'm·s⁻¹', '°', 'kg m/s^2'])
      expect(parseUnit(text), text).toBeTruthy()
  })
  it('tells a missing unit from an unknown one', () => {
    expect(parseUnit(undefined)).toBeUndefined()
    expect(parseUnit('')).toBeUndefined()
    expect(parseUnit('AU')).toBeNull()
    expect(parseUnit('%')).toBeNull()
  })
})

describe('checkCalculator', () => {
  it('finds nothing in a correct calculator', () => {
    expect(checkCalculator(orbit)).toEqual([])
  })

  it('reports a formula whose units do not give the output unit', () => {
    const wrong = { ...orbit, outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'mu / r^2' }] }
    expect(checkCalculator(wrong)).toEqual([
      { type: 'units', key: 'v', label: 'Speed', expected: 'km/s', actual: 'm / s^2' },
    ])
  })

  it('reports adding quantities of different kinds', () => {
    const wrong = { ...orbit, outputs: [{ key: 'x', label: 'Sum', unit: 'km', expr: 'r + mu' }] }
    expect(checkCalculator(wrong)).toContainEqual({
      type: 'units',
      key: 'x',
      label: 'Sum',
      expected: 'km',
      actual: null,
    })
  })

  it('accepts unit conversions written as numbers and angles in degrees', () => {
    const spec: CalculatorSpec = {
      version: 1,
      name: 'Projectile',
      inputs: [
        { key: 'v_kmh', label: 'Speed', unit: 'km/h', default: 72 },
        { key: 'theta', label: 'Angle', unit: 'deg', default: 30 },
        { key: 'g', label: 'Gravity', unit: 'm/s²', default: 9.81 },
      ],
      outputs: [
        { key: 'v', label: 'Speed', unit: 'm/s', expr: 'v_kmh / 3.6' },
        { key: 'T', label: 'Flight time', unit: 's', expr: '2 * v * sin(theta deg) / g' },
        { key: 'alpha', label: 'Angle back', unit: 'deg', expr: 'atan2(1, 1) * 180 / pi' },
      ],
    }
    expect(checkCalculator(spec)).toEqual([])
  })

  it('skips formulas that use a unit math.js does not know, instead of guessing', () => {
    const spec: CalculatorSpec = {
      version: 1,
      name: 'Distance',
      inputs: [{ key: 'd', label: 'Distance', unit: 'AU', default: 1 }],
      outputs: [
        { key: 'km', label: 'Distance', unit: 'km', expr: 'd * 149597870.7' },
        { key: 'm', label: 'Distance', unit: 'm', expr: 'km * 1000' },
      ],
    }
    expect(checkCalculator(spec)).toEqual([])
  })

  it('does not unit-check formulas that use a constant without a stated unit', () => {
    const spec: CalculatorSpec = {
      version: 1,
      name: 'Period',
      inputs: [{ key: 'a', label: 'Semi-major axis', unit: 'km', default: 7000 }],
      constants: { mu_E: 398600.4418 },
      outputs: [{ key: 'T', label: 'Period', unit: 's', expr: '2 * pi * sqrt(a^3 / mu_E)' }],
    }
    expect(checkCalculator(spec)).toEqual([])
    const withUnit = { ...spec, constantMetadata: { mu_E: { name: 'Earth μ', symbol: 'μ', unit: 'km³/s²' } } }
    expect(checkCalculator(withUnit)).toEqual([])
    const wrong = {
      ...withUnit,
      outputs: [{ key: 'T', label: 'Period', unit: 's', expr: '2 * pi * sqrt(a^2 / mu_E)' }],
    }
    expect(checkCalculator(wrong)).toEqual([
      { type: 'units', key: 'T', label: 'Period', expected: 's', actual: 's / m^0.5' },
    ])
  })

  it('reports unused inputs and constants, and formulas that fail with the defaults', () => {
    const spec: CalculatorSpec = {
      ...orbit,
      inputs: [...orbit.inputs, { key: 'm', label: 'Mass', unit: 'kg', default: 1000 }],
      constants: { G: 6.674e-20 },
      outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / (r - 7000))' }],
    }
    const issues = checkCalculator(spec)
    expect(issues).toContainEqual({ type: 'unused', key: 'm', label: 'Mass' })
    expect(issues).toContainEqual({ type: 'unused', key: 'G', label: 'G' })
    expect(issues).toContainEqual({ type: 'evaluation', key: 'v', message: 'Speed is not finite' })
  })
})

describe('diffSpecs', () => {
  it('lists changed formulas, added and removed items, and text changes', () => {
    const revised: CalculatorSpec = {
      ...orbit,
      theory: 'Gravity provides the centripetal force.',
      inputs: [
        orbit.inputs[0] as CalculatorSpec['inputs'][number],
        { ...orbit.inputs[1], default: 398600.4418 } as never,
      ],
      outputs: [
        { key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / r)', explanation: 'From μ/r² = v²/r.' },
        { key: 'P', label: 'Period', unit: 'min', expr: '2 * pi * r / v / 60' },
      ],
    }
    expect(diffSpecs(orbit, revised)).toEqual([
      {
        area: 'calculator',
        key: 'theory',
        field: 'theory',
        before: null,
        after: 'Gravity provides the centripetal force.',
      },
      { area: 'input', key: 'mu', field: 'default', before: '398600', after: '398600.4418' },
      { area: 'output', key: 'T', field: 'removed', before: 'T = 2 * pi * r / v [s]', after: null },
      { area: 'output', key: 'v', field: 'explanation', before: null, after: 'From μ/r² = v²/r.' },
      { area: 'output', key: 'P', field: 'added', before: null, after: 'P = 2 * pi * r / v / 60 [min]' },
    ])
    expect(diffSpecs(orbit, orbit)).toEqual([])
    const unitless: CalculatorSpec = { ...orbit, constants: { g0: 9.81 } }
    const withUnit = {
      ...unitless,
      constantMetadata: { g0: { name: 'Standard gravity', symbol: 'g₀', unit: 'm/s²' } },
    }
    expect(diffSpecs(unitless, withUnit)).toEqual([
      { area: 'constant', key: 'g0', field: 'unit', before: null, after: 'm/s²' },
    ])
  })
})
