import { describe, expect, it } from 'vitest'
import { missionFileKind, parseMissionSpacecraft } from './mission-files'
import { CENTRAL_BODIES, elementsToState } from './orbit'

describe('mission files', () => {
  it('recognises GMAT scripts and FreeFlyer mission plans by extension', () => {
    expect(missionFileKind('Hohmann.script')).toBe('gmat')
    expect(missionFileKind('LEO.MissionPlan')).toBe('freeflyer')
    expect(missionFileKind('notes.txt')).toBeNull()
  })

  it('reads Keplerian spacecraft from a GMAT script, ignoring comments', () => {
    const script = `%General Mission Analysis Tool(GMAT) Script
Create Spacecraft LEOsat GEOsat;
GMAT LEOsat.DisplayStateType = Keplerian;
GMAT LEOsat.SMA = 7191.938817629013;
GMAT LEOsat.ECC = 0.02454974900598137;
GMAT LEOsat.INC = 12.85008005658097;
GMAT LEOsat.RAAN = 306.6148021947984;
GMAT LEOsat.AOP = 314.1905515359921;
GMAT LEOsat.TA = 99.88774933204877;
% GMAT GEOsat.SMA = 1;
GEOsat.SMA = 42164; GEOsat.ECC = 0; GEOsat.INC = 0;
Create Propagator Prop;
GMAT Prop.InitialStepSize = 60;`
    const found = parseMissionSpacecraft(script, 'gmat')
    expect(found.map((s) => s.name)).toEqual(['LEOsat', 'GEOsat'])
    expect(found[0]).toMatchObject({
      body: 'earth',
      from: 'keplerian',
      elements: { a: 7191.938817629013, e: 0.02454974900598137, argp: 314.1905515359921 },
    })
    expect(found[1]?.elements).toMatchObject({ a: 42164, e: 0, i: 0, nu: 0 })
  })

  it('converts a Cartesian GMAT spacecraft (the GMAT default) to elements', () => {
    const script = `Create Spacecraft DefaultSC;
GMAT DefaultSC.CoordinateSystem = EarthMJ2000Eq;
GMAT DefaultSC.DisplayStateType = Cartesian;
GMAT DefaultSC.X = 7100;
GMAT DefaultSC.Y = 0;
GMAT DefaultSC.Z = 1300;
GMAT DefaultSC.VX = 0;
GMAT DefaultSC.VY = 7.35;
GMAT DefaultSC.VZ = 1;`
    const [sc] = parseMissionSpacecraft(script, 'gmat')
    expect(sc?.from).toBe('cartesian')
    // Converting back gives the position in the file.
    const { r } = elementsToState(sc?.elements as never, (CENTRAL_BODIES[0] as { mu: number }).mu)
    expect(r[0]).toBeCloseTo(7100, 6)
    expect(r[2]).toBeCloseTo(1300, 6)
  })

  it('takes the central body from a lunar coordinate system', () => {
    const script = `Create Spacecraft Orbiter;
GMAT Orbiter.CoordinateSystem = LunaMJ2000Eq;
GMAT Orbiter.SMA = 1837; GMAT Orbiter.ECC = 0.01;`
    expect(parseMissionSpacecraft(script, 'gmat')[0]?.body).toBe('moon')
  })

  it('reads FreeFlyer FreeForm assignments and leaves out unbound orbits', () => {
    const plan = `<Object Type="Spacecraft" Name="Sat1"/>
<FreeForm>
Spacecraft Sat1;
Spacecraft Escape;
Sat1.A = 7000; // km
Sat1.E = 0.001;
Sat1.I = 98.2;
Sat1.RAAN = -10;
Sat1.W = 90;
Sat1.TA = 0;
Escape.A = 7000;
Escape.E = 1.5;
</FreeForm>`
    const found = parseMissionSpacecraft(plan, 'freeflyer')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ name: 'Sat1', elements: { a: 7000, i: 98.2, raan: 350, argp: 90 } })
  })
})
