import { type OrbitalElements, type Vec3, bodyByKey, stateToElements } from './orbit'

/**
 * Read-only reading of GMAT scripts (.script) and FreeFlyer mission plans (.MissionPlan): finds each
 * spacecraft's initial orbit so it can be opened in the orbit viewer. Nothing in the file is run.
 */
export type MissionFileKind = 'gmat' | 'freeflyer'

export interface MissionSpacecraft {
  name: string
  body: string
  elements: OrbitalElements
  /** Whether the file gave Keplerian elements or a Cartesian state (converted here). */
  from: 'keplerian' | 'cartesian'
}

export function missionFileKind(name: string): MissionFileKind | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.script')) return 'gmat'
  if (lower.endsWith('.missionplan')) return 'freeflyer'
  return null
}

// Property names per tool for the same quantities.
const KEPLERIAN: Record<MissionFileKind, Record<keyof OrbitalElements, string>> = {
  gmat: { a: 'SMA', e: 'ECC', i: 'INC', raan: 'RAAN', argp: 'AOP', nu: 'TA' },
  freeflyer: { a: 'A', e: 'E', i: 'I', raan: 'RAAN', argp: 'W', nu: 'TA' },
}
const CARTESIAN = ['X', 'Y', 'Z', 'VX', 'VY', 'VZ'] as const

const NUMBER = '([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?)'
const wrap360 = (deg: number) => ((deg % 360) + 360) % 360

/** The central body implied by a GMAT coordinate system name such as `LunaMJ2000Eq`. */
function bodyFrom(coordinateSystem: string | undefined): string {
  const name = coordinateSystem?.toLowerCase() ?? ''
  if (name.includes('luna') || name.includes('moon')) return 'moon'
  if (name.includes('mars')) return 'mars'
  return 'earth'
}

/** Spacecraft with a readable initial orbit. Spacecraft on unbound (hyperbolic) orbits are left out. */
export function parseMissionSpacecraft(text: string, kind: MissionFileKind): MissionSpacecraft[] {
  // Drop comments: % in GMAT, // in FreeFlyer.
  const source = text.replace(kind === 'gmat' ? /%.*$/gm : /\/\/.*$/gm, '')
  const props = new Map<string, Map<string, string>>()
  const assignment = /(?:^|[\s;>])(?:GMAT\s+)?([A-Za-z_][\w]*)\.([A-Za-z]+)\s*=\s*([^;\n<]+)/g
  for (const [, object, property, value] of source.matchAll(assignment)) {
    if (!object || !property || value === undefined) continue
    const entry = props.get(object) ?? new Map<string, string>()
    entry.set(property.toUpperCase(), value.trim().replace(/^'|'$/g, ''))
    props.set(object, entry)
  }
  // GMAT declares spacecraft with `Create Spacecraft A B;`; FreeFlyer with `Spacecraft A;` or in XML.
  const declared = new Set<string>()
  const declaration = /\b(?:Create\s+)?Spacecraft\s+([A-Za-z_][\w\s,]*?)\s*(?:;|$|\n)/gm
  for (const [, names] of source.matchAll(declaration))
    for (const n of names?.split(/[\s,]+/) ?? []) if (n) declared.add(n)
  for (const [, n] of source.matchAll(/<Spacecraft\b[^>]*\bName="([^"]+)"/g)) if (n) declared.add(n)

  const names = Array.from(props.keys()).filter((n) => declared.size === 0 || declared.has(n))
  const found: MissionSpacecraft[] = []
  for (const name of names) {
    const p = props.get(name) as Map<string, string>
    const num = (key: string) => {
      const m = p.get(key)?.match(new RegExp(`^${NUMBER}$`))
      return m ? Number(m[1]) : undefined
    }
    const body = bodyFrom(p.get('COORDINATESYSTEM'))
    const keys = KEPLERIAN[kind]
    const kep = Object.fromEntries(Object.entries(keys).map(([k, prop]) => [k, num(prop)])) as Record<
      keyof OrbitalElements,
      number | undefined
    >
    let elements: OrbitalElements | null = null
    let from: MissionSpacecraft['from'] = 'keplerian'
    if (kep.a !== undefined && kep.e !== undefined) {
      elements = {
        a: kep.a,
        e: kep.e,
        i: kep.i ?? 0,
        raan: wrap360(kep.raan ?? 0),
        argp: wrap360(kep.argp ?? 0),
        nu: wrap360(kep.nu ?? 0),
      }
    } else {
      const state = CARTESIAN.map(num)
      if (state.every((v) => v !== undefined)) {
        const [x, y, z, vx, vy, vz] = state as number[]
        elements = stateToElements([x, y, z] as Vec3, [vx, vy, vz] as Vec3, bodyByKey(body).mu)
        from = 'cartesian'
      }
    }
    if (
      elements &&
      elements.a > 0 &&
      elements.e >= 0 &&
      elements.e < 0.99 &&
      elements.i >= 0 &&
      elements.i <= 180
    )
      found.push({ name, body, elements, from })
  }
  return found
}
