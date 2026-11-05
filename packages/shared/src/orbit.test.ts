import { describe, expect, it } from 'vitest'
import {
  calculatorSpecSchema,
  checkCalculator,
  evaluateCalculator,
  exportJSON,
  exportPython,
} from './calculator'
import {
  CENTRAL_BODIES,
  HOHMANN_CALCULATOR,
  ORBIT_CALCULATOR,
  ORBIT_PRESETS,
  type OrbitalElements,
  elementsToState,
  greenwichSiderealAngle,
  groundTrack,
  j2Rates,
  meanToTrue,
  orbitQuantities,
  orbitValues,
  project,
  propagate,
  solveKepler,
  speedArrowLength,
  stateToElements,
  subSatellitePoint,
  sweptSector,
  toDeg,
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

describe('animation and speeds', () => {
  const earth = CENTRAL_BODIES[0] as (typeof CENTRAL_BODIES)[number]
  const orbit = (e: number, nu: number): OrbitalElements => ({ a: 7000, e, i: 0, raan: 0, argp: 0, nu })
  const T = 2 * Math.PI * Math.sqrt(7000 ** 3 / earth.mu)
  const nuAfter = (e: number, nu: number, dt: number) => propagate(orbit(e, nu), earth, dt).nu

  it('advances the satellite by simulated time, fastest near periapsis', () => {
    expect(nuAfter(0, 0, T / 4)).toBeCloseTo(90, 6)
    expect(nuAfter(0.3, 123, T)).toBeCloseTo(123, 6)
    // Half a period from periapsis reaches apoapsis on any ellipse.
    expect(nuAfter(0.74, 0, T / 2)).toBeCloseTo(180, 6)
    // A quarter of the time covers more than a quarter of the angle when leaving periapsis.
    expect(nuAfter(0.5, 0, T / 4)).toBeGreaterThan(120)
  })

  it('draws the velocity arrow in proportion to the speed', () => {
    expect(speedArrowLength(9, 9)).toBe(72)
    // e = 0.5: apoapsis speed is a third of periapsis speed.
    expect(speedArrowLength(3, 9)).toBeCloseTo(24, 9)
    expect(speedArrowLength(0.1, 9)).toBe(10)
  })

  it('gives periapsis, apoapsis, circular and escape speeds', () => {
    const mu = 398600.4418
    const circular = evaluateCalculator(ORBIT_CALCULATOR, { a: 6795, ecc: 0, nu: 0, mu })
    expect(circular.ok).toBe(true)
    if (!circular.ok) return
    const v = circular.values
    expect(v.vp).toBeCloseTo(Math.sqrt(mu / 6795), 9)
    expect(v.va).toBeCloseTo(v.vp as number, 9)
    expect(v.vcirc).toBeCloseTo(v.v as number, 9)
    expect(v.vesc).toBeCloseTo(Math.SQRT2 * (v.vcirc as number), 9)
    const molniya = evaluateCalculator(ORBIT_CALCULATOR, { a: 26600, ecc: 0.74, nu: 0, mu })
    expect(molniya.ok && (molniya.values.vp as number) / (molniya.values.va as number)).toBeCloseTo(
      1.74 / 0.26,
      9,
    )
  })

  it('has formulas whose units match their outputs', () => {
    expect(checkCalculator(ORBIT_CALCULATOR)).toEqual([])
  })
})

describe('J2, ground tracks and Hohmann transfers', () => {
  const earth = CENTRAL_BODIES[0] as (typeof CENTRAL_BODIES)[number]
  const DAY = 86400
  const preset = (key: string) =>
    (ORBIT_PRESETS.find((p) => p.key === key) as { elements: OrbitalElements }).elements
  const perDay = (degPerSecond: number) => degPerSecond * DAY

  it('matches the known J2 drift of reference orbits', () => {
    // The ISS node regresses about 5° a day.
    expect(perDay(j2Rates(preset('iss'), earth).raan)).toBeCloseTo(-4.95, 1)
    // A Sun-synchronous orbit's node turns with the Sun: 360° / 365.2422 days ≈ 0.9856° a day.
    expect(perDay(j2Rates(preset('sso'), earth).raan)).toBeCloseTo(0.9856, 1)
    // At the critical inclination 63.4° the periapsis stays put (Molniya, Tundra).
    expect(Math.abs(perDay(j2Rates(preset('molniya'), earth).argp))).toBeLessThan(0.001)
    expect(Math.abs(perDay(j2Rates(preset('tundra'), earth).argp))).toBeLessThan(0.001)
    // Retrograde orbits drift eastward, prograde ones westward.
    expect(j2Rates({ ...preset('iss'), i: 120 }, earth).raan).toBeGreaterThan(0)
  })

  it('gives the same J2 drift in the orbit calculator', () => {
    const el = preset('sso')
    const calc = evaluateCalculator(ORBIT_CALCULATOR, {
      a: el.a,
      ecc: el.e,
      nu: el.nu,
      mu: earth.mu,
      inc: el.i,
      J2: earth.j2,
      Re: earth.radius,
    })
    expect(calc.ok).toBe(true)
    if (!calc.ok) return
    expect(calc.values.dOmega).toBeCloseTo(perDay(j2Rates(el, earth).raan), 9)
    expect(calc.values.domega).toBeCloseTo(perDay(j2Rates(el, earth).argp), 9)
  })

  it('propagates directly: a whole period returns, and J2 turns the node at its rate', () => {
    const el = { ...preset('molniya'), nu: 40 }
    const T = 2 * Math.PI * Math.sqrt(el.a ** 3 / earth.mu)
    expect(propagate(el, earth, T).nu).toBeCloseTo(40, 6)
    expect(propagate(el, earth, 0)).toBe(el)
    const later = propagate(el, earth, 10 * DAY, true)
    expect(later.raan).toBeCloseTo((((el.raan + 10 * DAY * j2Rates(el, earth).raan) % 360) + 360) % 360, 9)
    expect(later.argp).toBeCloseTo(el.argp, 1)
  })

  it('traces ground tracks that move with the body’s rotation', () => {
    const iss = preset('iss')
    const T = 2 * Math.PI * Math.sqrt(iss.a ** 3 / earth.mu)
    // One orbit later the track has moved west by the Earth’s turn in that time (≈ 23.3°).
    expect(subSatellitePoint(iss, earth, T).lon).toBeCloseTo(toDeg(-earth.rotationRate * T), 6)
    // The track stays within ± the inclination.
    const lats = groundTrack(iss, earth, 0, 3 * T).map((p) => p.lat)
    expect(Math.max(...lats)).toBeCloseTo(51.64, 1)
    expect(Math.min(...lats)).toBeCloseTo(-51.64, 1)
    // A geostationary satellite stays over one point.
    const geo = { a: 42164.17, e: 0, i: 0, raan: 0, argp: 0, nu: 0 }
    for (const p of groundTrack(geo, earth, 0, DAY, 24))
      expect(Math.abs(p.lon) + Math.abs(p.lat)).toBeLessThan(0.01)
  })

  it('computes a Hohmann transfer from LEO to GEO (Curtis, Example 6.1)', () => {
    const h = evaluateCalculator(HOHMANN_CALCULATOR, { r1: 6678, r2: 42164, mu: earth.mu })
    expect(h.ok).toBe(true)
    if (!h.ok) return
    expect(h.values.dv).toBeCloseTo(3.893, 3)
    expect((h.values.tt as number) / 3600).toBeCloseTo(5.275, 2)
    // Going down costs the same Δv as going up.
    const down = evaluateCalculator(HOHMANN_CALCULATOR, { r1: 42164, r2: 6678, mu: earth.mu })
    expect(down.ok && down.values.dv).toBeCloseTo(h.values.dv as number, 9)
    expect(checkCalculator(HOHMANN_CALCULATOR)).toEqual([])
  })
})

describe('display without the calculator engine', () => {
  it('computes the same values as the orbit calculator', () => {
    for (const body of CENTRAL_BODIES)
      for (const { elements: el } of ORBIT_PRESETS) {
        const orbit = { ...el, a: Math.max(el.a, body.radius * 1.2), nu: 137 }
        const calc = evaluateCalculator(ORBIT_CALCULATOR, {
          a: orbit.a,
          ecc: orbit.e,
          nu: orbit.nu,
          mu: body.mu,
          inc: orbit.i,
          J2: body.j2,
          Re: body.radius,
        })
        expect(calc.ok).toBe(true)
        if (!calc.ok) continue
        const plain = orbitValues(orbit, body)
        expect(Object.keys(plain).sort()).toEqual(Object.keys(calc.values).sort())
        for (const [key, value] of Object.entries(calc.values))
          expect(plain[key], `${body.key} ${key}`).toBeCloseTo(value, 9)
      }
  })
})

describe('real longitudes', () => {
  it('gives the Greenwich sidereal angle of a date', () => {
    expect(greenwichSiderealAngle(new Date('2000-01-01T12:00:00Z'))).toBeCloseTo(280.4606, 3)
    // Vallado, Fundamentals of Astrodynamics, Example 3-5: 1992-08-20 12:14 UT1 → 152.578788°.
    expect(greenwichSiderealAngle(new Date('1992-08-20T12:14:00Z'))).toBeCloseTo(152.5788, 2)
  })

  it('places the satellite under its real longitude when the starting angle is given', () => {
    const geo = { a: 42164.17, e: 0, i: 0, raan: 75, argp: 0, nu: 0 }
    const earth = CENTRAL_BODIES[0] as (typeof CENTRAL_BODIES)[number]
    // Right ascension 75° with Greenwich at 20°: the satellite is over 55°E, and stays there.
    expect(subSatellitePoint(geo, earth, 0, false, 20).lon).toBeCloseTo(55, 6)
    expect(subSatellitePoint(geo, earth, 43200, false, 20).lon).toBeCloseTo(55, 1)
  })
})

describe('checked against numerical integration', () => {
  const earth = CENTRAL_BODIES[0] as (typeof CENTRAL_BODIES)[number]
  type State = number[]
  // Two-body gravity plus the J2 term, integrated with fixed-step RK4: an independent check of the formulas above.
  const derivative = (s: State, withJ2: boolean): State => {
    const [x = 0, y = 0, z = 0] = s
    const r = Math.hypot(x, y, z)
    const k = -earth.mu / r ** 3
    const f = withJ2 ? (1.5 * earth.j2 * earth.mu * earth.radius ** 2) / r ** 5 : 0
    const zz = (5 * z * z) / (r * r)
    return [
      s[3] ?? 0,
      s[4] ?? 0,
      s[5] ?? 0,
      k * x + f * x * (zz - 1),
      k * y + f * y * (zz - 1),
      k * z + f * z * (zz - 3),
    ]
  }
  const step = (s: State, h: number, withJ2: boolean): State => {
    const add = (u: State, v: State, c: number) => u.map((x, i) => x + c * (v[i] ?? 0))
    const k1 = derivative(s, withJ2)
    const k2 = derivative(add(s, k1, h / 2), withJ2)
    const k3 = derivative(add(s, k2, h / 2), withJ2)
    const k4 = derivative(add(s, k3, h), withJ2)
    return s.map((x, i) => x + (h / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0)))
  }
  const stateOf = (el: OrbitalElements): State => {
    const { r, v } = elementsToState(el, earth.mu)
    return [...r, ...v]
  }

  it('propagates a Molniya orbit to the integrated position', () => {
    const el = { a: 26600, e: 0.74, i: 63.4, raan: 40, argp: 270, nu: 10 }
    const t = 1.37 * 2 * Math.PI * Math.sqrt(el.a ** 3 / earth.mu)
    let s = stateOf(el)
    const n = 20000
    for (let k = 0; k < n; k++) s = step(s, t / n, false)
    const r = elementsToState(propagate(el, earth, t), earth.mu).r
    expect(Math.hypot((s[0] ?? 0) - r[0], (s[1] ?? 0) - r[1], (s[2] ?? 0) - r[2])).toBeLessThan(1e-3)
  })

  it('drifts the node and periapsis at the integrated J2 rates (within 1%)', () => {
    const el = { a: 8000, e: 0.1, i: 30, raan: 0, argp: 45, nu: 0 }
    let s = stateOf(el)
    const days = 20
    const raan: number[] = []
    const argp: number[] = []
    for (let day = 0; day <= days; day++) {
      const o = stateToElements(
        [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0],
        [s[3] ?? 0, s[4] ?? 0, s[5] ?? 0],
        earth.mu,
      )
      raan.push(o?.raan ?? Number.NaN)
      argp.push(o?.argp ?? Number.NaN)
      for (let k = 0; k < 4320; k++) s = step(s, 20, true)
    }
    // Least-squares slope over the daily samples averages out the short-period oscillations.
    const slope = (ys: number[]) => {
      const mx = (ys.length - 1) / 2
      const my = ys.reduce((a, b) => a + b, 0) / ys.length
      let sxy = 0
      let sxx = 0
      ys.forEach((y, x) => {
        sxy += (x - mx) * (y - my)
        sxx += (x - mx) ** 2
      })
      return sxy / sxx
    }
    const rates = j2Rates(el, earth)
    const unwrapped = raan.map((r) => (r > 180 ? r - 360 : r))
    expect(Math.abs(slope(unwrapped) / (rates.raan * 86400) - 1)).toBeLessThan(0.01)
    expect(Math.abs(slope(argp) / (rates.argp * 86400) - 1)).toBeLessThan(0.01)
  })
})
