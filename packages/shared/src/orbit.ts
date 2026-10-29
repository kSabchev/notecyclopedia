import type { CalculatorSpec } from './calculator'

/**
 * Two-body orbit math for closed (elliptical) orbits, 0 <= e < 1. Distances in km, times in seconds,
 * angles in degrees at the API boundary (radians inside). Inertial frame: x towards the reference
 * direction (vernal equinox for Earth), z towards the reference pole, xy the reference plane.
 */

export type Vec3 = [number, number, number]

/** The six classical (Keplerian) orbital elements. Angles in degrees. */
export interface OrbitalElements {
  /** Semi-major axis (km). */
  a: number
  /** Eccentricity, 0 <= e < 1. */
  e: number
  /** Inclination (deg). */
  i: number
  /** Right ascension of the ascending node, Ω (deg). */
  raan: number
  /** Argument of periapsis, ω (deg). */
  argp: number
  /** True anomaly, ν (deg). */
  nu: number
}

export interface CentralBody {
  key: string
  name: string
  /** Gravitational parameter μ (km³/s²). */
  mu: number
  /** Mean equatorial radius (km). */
  radius: number
}

export const CENTRAL_BODIES: CentralBody[] = [
  { key: 'earth', name: 'Earth', mu: 398600.4418, radius: 6378.137 },
  { key: 'moon', name: 'Moon', mu: 4902.8, radius: 1737.4 },
  { key: 'mars', name: 'Mars', mu: 42828.37, radius: 3396.2 },
]

export const bodyByKey = (key: string | undefined): CentralBody =>
  CENTRAL_BODIES.find((b) => b.key === key) ?? (CENTRAL_BODIES[0] as CentralBody)

/** Well-known Earth orbits. GTO: 250 km × 35 786 km altitude. */
export const ORBIT_PRESETS: { key: string; name: string; elements: OrbitalElements }[] = [
  { key: 'iss', name: 'ISS (LEO)', elements: { a: 6795, e: 0.0005, i: 51.64, raan: 0, argp: 0, nu: 0 } },
  { key: 'sso', name: 'Sun-synchronous', elements: { a: 7078, e: 0.001, i: 98.2, raan: 0, argp: 0, nu: 0 } },
  {
    key: 'gto',
    name: 'Geostationary transfer',
    elements: { a: 24396, e: 0.7283, i: 27, raan: 0, argp: 0, nu: 0 },
  },
  { key: 'geo', name: 'Geostationary', elements: { a: 42164, e: 0, i: 0, raan: 0, argp: 0, nu: 0 } },
  { key: 'molniya', name: 'Molniya', elements: { a: 26600, e: 0.74, i: 63.4, raan: 0, argp: 270, nu: 0 } },
  { key: 'tundra', name: 'Tundra', elements: { a: 42164, e: 0.27, i: 63.4, raan: 0, argp: 270, nu: 0 } },
]

const TAU = 2 * Math.PI
export const toRad = (deg: number) => (deg * Math.PI) / 180
export const toDeg = (rad: number) => (rad * 180) / Math.PI
/** An angle in [0, 2π). */
const wrap = (rad: number) => ((rad % TAU) + TAU) % TAU

/** Eccentric anomaly E from mean anomaly M (rad) by Newton's method on Kepler's equation M = E − e·sin E. */
export function solveKepler(M: number, e: number, tolerance = 1e-12): number {
  const m = wrap(M)
  let E = e < 0.8 ? m : Math.PI
  for (let k = 0; k < 50; k++) {
    const step = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E))
    E -= step
    if (Math.abs(step) < tolerance) break
  }
  return wrap(E)
}

/** True anomaly ν from eccentric anomaly E (rad). */
export const eccentricToTrue = (E: number, e: number) =>
  wrap(2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2)))

/** Eccentric anomaly E from true anomaly ν (rad). */
export const trueToEccentric = (nu: number, e: number) =>
  wrap(2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2)))

/** Mean anomaly M from true anomaly ν (rad). */
export function trueToMean(nu: number, e: number): number {
  const E = trueToEccentric(nu, e)
  return wrap(E - e * Math.sin(E))
}

/** True anomaly ν from mean anomaly M (rad). */
export const meanToTrue = (M: number, e: number) => eccentricToTrue(solveKepler(M, e), e)

export interface OrbitQuantities {
  /** Periapsis and apoapsis radius (km). */
  rp: number
  ra: number
  /** Semi-minor axis and semi-latus rectum (km). */
  b: number
  p: number
  /** Period (s) and mean motion (rad/s). */
  period: number
  n: number
  /** Specific angular momentum (km²/s) and specific orbital energy (km²/s²). */
  h: number
  energy: number
  /** Radius (km), speed (km/s) and flight-path angle (deg) at the current true anomaly. */
  r: number
  v: number
  gamma: number
  /** Speed at periapsis and apoapsis (km/s). */
  vp: number
  va: number
  /** Time since periapsis passage (s). */
  sincePeriapsis: number
}

/** Shape, timing and the current state of an orbit around a body with gravitational parameter `mu`. */
export function orbitQuantities(el: OrbitalElements, mu: number): OrbitQuantities {
  const { a, e } = el
  const nu = toRad(el.nu)
  const p = a * (1 - e * e)
  const h = Math.sqrt(mu * p)
  const r = p / (1 + e * Math.cos(nu))
  const n = Math.sqrt(mu / a ** 3)
  const rp = a * (1 - e)
  const ra = a * (1 + e)
  return {
    rp,
    ra,
    b: a * Math.sqrt(1 - e * e),
    p,
    period: TAU / n,
    n,
    h,
    energy: -mu / (2 * a),
    r,
    // Vis-viva: v² = μ(2/r − 1/a).
    v: Math.sqrt(mu * (2 / r - 1 / a)),
    gamma: toDeg(Math.atan2(e * Math.sin(nu), 1 + e * Math.cos(nu))),
    vp: h / rp,
    va: h / ra,
    sincePeriapsis: trueToMean(nu, e) / n,
  }
}

/** Position (km) in the perifocal frame (x towards periapsis, z along the angular momentum) at true anomaly ν (rad). */
export function perifocalPosition(a: number, e: number, nu: number): [number, number] {
  const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu))
  return [r * Math.cos(nu), r * Math.sin(nu)]
}

/** Velocity (km/s) in the perifocal frame at true anomaly ν (rad). */
export function perifocalVelocity(a: number, e: number, nu: number, mu: number): [number, number] {
  const k = Math.sqrt(mu / (a * (1 - e * e)))
  return [-k * Math.sin(nu), k * (e + Math.cos(nu))]
}

/** Rotate a perifocal vector into the inertial frame: R3(−Ω)·R1(−i)·R3(−ω). */
export function perifocalToInertial(el: OrbitalElements, [x, y, z = 0]: [number, number, number?]): Vec3 {
  const [O, i, w] = [toRad(el.raan), toRad(el.i), toRad(el.argp)]
  const [cO, sO, ci, si, cw, sw] = [
    Math.cos(O),
    Math.sin(O),
    Math.cos(i),
    Math.sin(i),
    Math.cos(w),
    Math.sin(w),
  ]
  return [
    (cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y + sO * si * z,
    (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y - cO * si * z,
    sw * si * x + cw * si * y + ci * z,
  ]
}

/** Inertial position (km) and velocity (km/s). */
export function elementsToState(el: OrbitalElements, mu: number): { r: Vec3; v: Vec3 } {
  const nu = toRad(el.nu)
  return {
    r: perifocalToInertial(el, perifocalPosition(el.a, el.e, nu)),
    v: perifocalToInertial(el, perifocalVelocity(el.a, el.e, nu, mu)),
  }
}

const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
const cross = (u: Vec3, v: Vec3): Vec3 => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
]
const norm = (u: Vec3) => Math.hypot(u[0], u[1], u[2])

/**
 * Classical elements from an inertial state. Angles that are undefined for circular or equatorial
 * orbits are set to 0 and folded into the next angle (so the position is still right).
 * Returns null for an unbound (parabolic or hyperbolic) state.
 */
export function stateToElements(r: Vec3, v: Vec3, mu: number): OrbitalElements | null {
  const rn = norm(r)
  const h = cross(r, v)
  const hn = norm(h)
  const node: Vec3 = [-h[1], h[0], 0]
  const nn = norm(node)
  const ev = (dot(v, v) - mu / rn) / mu
  const ecc: Vec3 = [
    ev * r[0] - (dot(r, v) / mu) * v[0],
    ev * r[1] - (dot(r, v) / mu) * v[1],
    ev * r[2] - (dot(r, v) / mu) * v[2],
  ]
  const e = norm(ecc)
  const energy = dot(v, v) / 2 - mu / rn
  if (energy >= 0 || e >= 1) return null
  const a = -mu / (2 * energy)
  const i = Math.acos(Math.min(1, Math.max(-1, h[2] / hn)))
  const tiny = 1e-10
  const angle = (u: Vec3, w: Vec3) => Math.acos(Math.min(1, Math.max(-1, dot(u, w) / (norm(u) * norm(w)))))
  let raan = nn > tiny ? Math.acos(Math.min(1, Math.max(-1, node[0] / nn))) : 0
  if (node[1] < 0) raan = TAU - raan
  let argp: number
  let nu: number
  if (e > tiny) {
    const ref: Vec3 = nn > tiny ? node : [1, 0, 0]
    argp = angle(ref, ecc)
    if ((nn > tiny ? ecc[2] : cross(ref, ecc)[2] * Math.sign(h[2])) < 0) argp = TAU - argp
    nu = angle(ecc, r)
    if (dot(r, v) < 0) nu = TAU - nu
  } else {
    // Circular: measure the position from the node (or the x-axis when also equatorial).
    argp = 0
    const ref: Vec3 = nn > tiny ? node : [1, 0, 0]
    nu = angle(ref, r)
    if ((nn > tiny ? r[2] : cross(ref, r)[2] * Math.sign(h[2])) < 0) nu = TAU - nu
  }
  return { a, e, i: toDeg(i), raan: toDeg(raan), argp: toDeg(argp), nu: toDeg(nu) }
}

/** Points (km, inertial frame) around the whole orbit, starting at periapsis. */
export function orbitPath(el: OrbitalElements, samples = 180): Vec3[] {
  return Array.from({ length: samples + 1 }, (_, k) =>
    perifocalToInertial(el, perifocalPosition(el.a, el.e, (TAU * k) / samples)),
  )
}

/** A 3D view direction: `yaw` turns about the pole, `pitch` raises the eye above the reference plane (deg). */
export interface ViewAngles {
  yaw: number
  pitch: number
}

/**
 * Orthographic projection to screen coordinates (x right, y down) plus depth (larger = further away),
 * for a camera that looks at the origin from the direction given by `view`.
 */
export function project([x, y, z]: Vec3, view: ViewAngles): { x: number; y: number; depth: number } {
  const yaw = toRad(view.yaw)
  const pitch = toRad(view.pitch)
  const x1 = x * Math.cos(yaw) - y * Math.sin(yaw)
  const y1 = x * Math.sin(yaw) + y * Math.cos(yaw)
  return {
    x: x1,
    y: -(z * Math.cos(pitch) + y1 * Math.sin(pitch)),
    depth: y1 * Math.cos(pitch) - z * Math.sin(pitch),
  }
}

/** Perifocal points (km) of the sector swept from true anomaly ν1 to ν2 (rad), for the equal-areas overlay. */
export function sweptSector(
  a: number,
  e: number,
  nu1: number,
  nu2: number,
  samples = 24,
): [number, number][] {
  const span = wrap(nu2 - nu1) || TAU
  const points: [number, number][] = [[0, 0]]
  for (let k = 0; k <= samples; k++) points.push(perifocalPosition(a, e, nu1 + (span * k) / samples))
  return points
}

/**
 * The orbit's derived quantities as an ordinary calculator, so the orbit diagram shows the same formulas
 * readers find in calculators, and they can be saved to the library and exported.
 */
export const ORBIT_CALCULATOR: CalculatorSpec = {
  version: 1,
  name: 'Elliptical orbit',
  description: 'Two-body orbit quantities from the semi-major axis, eccentricity and true anomaly.',
  inputs: [
    { key: 'a', label: 'Semi-major axis', unit: 'km', default: 7000, min: 1 },
    { key: 'ecc', label: 'Eccentricity', default: 0.1, min: 0, max: 0.99, step: 0.01 },
    { key: 'nu', label: 'True anomaly', unit: 'deg', default: 0, min: 0, max: 360 },
    { key: 'mu', label: 'Gravitational parameter', unit: 'km³/s²', default: 398600.4418 },
  ],
  outputs: [
    { key: 'rp', label: 'Periapsis radius', unit: 'km', expr: 'a * (1 - ecc)', precision: 1 },
    { key: 'ra', label: 'Apoapsis radius', unit: 'km', expr: 'a * (1 + ecc)', precision: 1 },
    { key: 'p', label: 'Semi-latus rectum', unit: 'km', expr: 'a * (1 - ecc^2)', precision: 1 },
    { key: 'T', label: 'Period', unit: 's', expr: '2 * pi * sqrt(a^3 / mu)', precision: 0 },
    { key: 'h', label: 'Specific angular momentum', unit: 'km²/s', expr: 'sqrt(mu * p)', precision: 0 },
    { key: 'eps', label: 'Specific orbital energy', unit: 'km²/s²', expr: '-mu / (2 * a)', precision: 3 },
    { key: 'r', label: 'Radius', unit: 'km', expr: 'p / (1 + ecc * cos(nu deg))', precision: 1 },
    { key: 'v', label: 'Speed (vis-viva)', unit: 'km/s', expr: 'sqrt(mu * (2 / r - 1 / a))', precision: 3 },
    {
      key: 'gamma',
      label: 'Flight-path angle',
      unit: 'deg',
      expr: 'atan2(ecc * sin(nu deg), 1 + ecc * cos(nu deg)) * 180 / pi',
      precision: 2,
    },
  ],
}
