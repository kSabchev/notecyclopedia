import { describe, expect, it } from 'vitest'
import { calculatorSpecSchema, evaluateCalculator, exportJSON, exportPython } from './calculator'
import {
  CENTRAL_BODIES,
  ORBIT_CALCULATOR,
  ORBIT_PRESETS,
  type OrbitalElements,
  elementsToState,
  meanToTrue,
  orbitQuantities,
  project,
  solveKepler,
  stateToElements,
  sweptSector,
  toRad,
  trueToMean,
} from './orbit'

const MU = (CENTRAL_BODIES[0] as { mu: number }).mu

describe('Kepler equation', () => {
  it('solves M = E − e·sin E across eccentricities', () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.99])
      for (const M of [0.01, 1, 2.5, Math.PI, 4, 6.2]) {
        const E = solveKepler(M, e)
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 10)
      }
  })

  it('converts true ↔ mean anomaly both ways', () => {
    for (const e of [0, 0.3, 0.74])
      for (const nu of [0, 1, 3, 5]) expect(meanToTrue(trueToMean(nu, e), e)).toBeCloseTo(nu, 9)
  })
})

describe('orbit quantities', () => {
  it('matches known values for geostationary orbit', () => {
    const geo = orbitQuantities({ a: 42164, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }, MU)
    expect(geo.period).toBeCloseTo(86164, -1) // one sidereal day
    expect(geo.v).toBeCloseTo(3.0747, 3)
  })

  it('obeys vis-viva and conservation of angular momentum', () => {
    const q = orbitQuantities({ a: 24396, e: 0.7283, i: 27, raan: 0, argp: 0, nu: 120 }, MU)
    expect(q.rp * q.vp).toBeCloseTo(q.ra * q.va, 6)
    expect(q.v ** 2 / 2 - MU / q.r).toBeCloseTo(q.energy, 6)
    expect(q.rp).toBeCloseTo(6628.1, 0)
  })

  it('agrees with the orbit calculator, which is a valid portable calculator', () => {
    expect(calculatorSpecSchema.safeParse(ORBIT_CALCULATOR).success).toBe(true)
    expect(() => exportPython(ORBIT_CALCULATOR)).not.toThrow()
    expect(() => exportJSON(ORBIT_CALCULATOR)).not.toThrow()
    const el: OrbitalElements = { a: 26600, e: 0.74, i: 63.4, raan: 0, argp: 270, nu: 75 }
    const q = orbitQuantities(el, MU)
    const run = evaluateCalculator(ORBIT_CALCULATOR, { a: el.a, ecc: el.e, nu: el.nu, mu: MU })
    expect(run.ok).toBe(true)
    if (!run.ok) return
    expect(run.values.T).toBeCloseTo(q.period, 6)
    expect(run.values.r).toBeCloseTo(q.r, 6)
    expect(run.values.v).toBeCloseTo(q.v, 9)
    expect(run.values.gamma).toBeCloseTo(q.gamma, 9)
  })
})

describe('state vectors', () => {
  it('round-trips elements through position and velocity', () => {
    const cases: OrbitalElements[] = [
      ...ORBIT_PRESETS.filter((p) => p.elements.e > 0.01 && p.elements.i > 1).map((p) => ({
        ...p.elements,
        raan: 40,
        nu: 33,
      })),
      { a: 9000, e: 0.2, i: 120, raan: 300, argp: 45, nu: 250 },
    ]
    for (const el of cases) {
      const { r, v } = elementsToState(el, MU)
      const back = stateToElements(r, v, MU)
      expect(back).not.toBeNull()
      for (const key of ['a', 'e', 'i', 'raan', 'argp', 'nu'] as const)
        expect(back?.[key]).toBeCloseTo(el[key], key === 'a' ? 3 : 6)
    }
  })

  it('puts a circular equatorial orbit in the reference plane at radius a', () => {
    const { r, v } = elementsToState({ a: 7000, e: 0, i: 0, raan: 0, argp: 0, nu: 90 }, MU)
    expect(r[0]).toBeCloseTo(0, 6)
    expect(r[1]).toBeCloseTo(7000, 6)
    expect(r[2]).toBeCloseTo(0, 9)
    expect(Math.hypot(...v)).toBeCloseTo(Math.sqrt(MU / 7000), 9)
  })

  it('starts at the ascending node heading north when ω = ν = 0', () => {
    const { r, v } = elementsToState({ a: 8000, e: 0, i: 45, raan: 90, argp: 0, nu: 0 }, MU)
    expect(r[0]).toBeCloseTo(0, 6)
    expect(r[1]).toBeCloseTo(8000, 6)
    expect(v[2]).toBeGreaterThan(0)
  })

  it('rejects unbound states', () => {
    expect(stateToElements([7000, 0, 0], [0, 20, 0], MU)).toBeNull()
  })
})

describe('drawing helpers', () => {
  it('projects the pole straight up when looking from the reference plane', () => {
    const p = project([0, 0, 1], { yaw: 0, pitch: 0 })
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(-1)
  })

  it('sweeps a sector from the focus between two anomalies', () => {
    const sector = sweptSector(7000, 0.5, 0, toRad(90), 4)
    expect(sector[0]).toEqual([0, 0])
    expect(sector).toHaveLength(6)
    expect(sector.at(-1)?.[0]).toBeCloseTo(0, 6)
  })
})
