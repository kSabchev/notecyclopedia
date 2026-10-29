import { describe, expect, it } from 'vitest'
import type { CalculatorSpec } from './calculator'
import { docToText } from './doc'
import { defaultPlotRange, invalidWidget, samplePlot } from './widget-runtime'

const spec: CalculatorSpec = {
  version: 1,
  name: 'Circular orbit',
  inputs: [
    { key: 'r', label: 'Radius', unit: 'km', default: 7000, min: 6500, max: 42000 },
    { key: 'mu', label: 'Gravitational parameter', unit: 'km³/s²', default: 398600 },
  ],
  outputs: [
    { key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / r)' },
    { key: 'T', label: 'Period', unit: 's', expr: '2 * pi * sqrt(r^3 / mu)' },
  ],
}
const doc = (attrs: unknown) => ({ type: 'doc' as const, content: [{ type: 'widget', attrs }] })

describe('widgets', () => {
  it('accepts valid calculator and plot widgets', () => {
    expect(invalidWidget(doc({ kind: 'calculator', spec, sourceCalculatorId: null }))).toBeNull()
    expect(
      invalidWidget(doc({ kind: 'plot', spec, plot: { x: 'r', y: ['v'], from: 6500, to: 42000 } })),
    ).toBeNull()
  })

  it('rejects unknown keys, bad ranges and invalid specs', () => {
    const plot = (p: object) => doc({ kind: 'plot', spec, plot: { x: 'r', y: ['v'], from: 0, to: 1, ...p } })
    expect(invalidWidget(plot({ x: 'nope' }))).toContain('Unknown input "nope"')
    expect(invalidWidget(plot({ y: ['nope'] }))).toContain('Unknown output "nope"')
    expect(invalidWidget(plot({ from: 2, to: 1 }))).toContain('range')
    expect(invalidWidget(doc({ kind: 'calculator', spec: { ...spec, outputs: [] } }))).toContain('outputs')
    expect(invalidWidget(doc({ kind: 'mystery' }))).toContain('Invalid widget')
  })

  it('samples the sweep and leaves gaps where evaluation fails', () => {
    const points = samplePlot(
      spec,
      { x: 'r', y: ['v'], from: 0, to: 7000, samples: 11 },
      { r: 1, mu: 398600 },
    )
    expect(points).toHaveLength(11)
    expect(points[0]?.y.v).toBeNull() // division by zero is not finite
    expect(points[10]?.x).toBe(7000)
    expect(points[10]?.y.v).toBeCloseTo(7.546, 3)
  })

  it('defaults the sweep to the input range, or around its default', () => {
    expect(defaultPlotRange(spec, 'r')).toEqual({ from: 6500, to: 42000 })
    expect(defaultPlotRange(spec, 'mu')).toEqual({ from: 0, to: 797200 })
  })

  it('describes widgets and images in page text', () => {
    const text = docToText({
      type: 'doc',
      content: [
        { type: 'widget', attrs: { kind: 'plot', spec, plot: { x: 'r', y: ['v', 'T'], from: 1, to: 2 } } },
        { type: 'widget', attrs: { kind: 'calculator', spec } },
        { type: 'image', attrs: { fileId: 'f', caption: 'Hohmann transfer' } },
      ],
    })
    expect(text).toContain('Plot of Speed [km/s], Period [s] against Radius [km] from 1 to 2')
    expect(text).toContain('Outputs: Speed [km/s] = sqrt(mu / r)')
    expect(text).toContain('Image: Hohmann transfer')
  })
})

describe('orbit widgets', () => {
  const orbit = (elements: object, body = 'earth') =>
    doc({
      kind: 'orbit',
      body,
      elements: { a: 26600, e: 0.74, i: 63.4, raan: 0, argp: 270, nu: 0, ...elements },
    })

  it('accepts closed orbits around a known body', () => {
    expect(invalidWidget(orbit({}))).toBeNull()
    expect(invalidWidget(orbit({}, 'mars'))).toBeNull()
  })

  it('rejects open orbits, out-of-range angles and unknown bodies', () => {
    expect(invalidWidget(orbit({ e: 1.2 }))).toContain('elements.e')
    expect(invalidWidget(orbit({ i: 200 }))).toContain('elements.i')
    expect(invalidWidget(orbit({ a: -1 }))).toContain('elements.a')
    expect(invalidWidget(orbit({}, 'pluto'))).toContain('body')
  })

  it('describes the elements in page text', () => {
    expect(docToText(orbit({}))).toContain(
      'Orbit diagram around Earth: semi-major axis a = 26600 km, eccentricity e = 0.74, inclination i = 63.4°',
    )
  })
})
