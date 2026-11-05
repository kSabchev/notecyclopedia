import {
  CENTRAL_BODIES,
  type CentralBody,
  MAX_ECCENTRICITY,
  ORBIT_CALCULATOR,
  ORBIT_PRESETS,
  type OrbitalElements,
  type Vec3,
  type ViewAngles,
  bodyByKey,
  formatFixed,
  formatValue,
  greenwichSiderealAngle,
  groundTrack,
  meanToTrue,
  orbitPath,
  orbitQuantities,
  orbitValues,
  perifocalPosition,
  perifocalToInertial,
  perifocalVelocity,
  project,
  propagate,
  speedArrowLength,
  subSatellitePoint,
  sweptSector,
  toDeg,
  toRad,
} from '@nc/shared'
import {
  type PointerEvent as ReactPointerEvent,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button, inputCls } from '../ui'

const SIZE = 400
/** The plane view is wider than tall: orbits are ellipses, and a fixed height keeps the page still while e changes. */
const PLANE_HEIGHT = 300
const DEFAULT_VIEW: ViewAngles = { yaw: -35, pitch: 25 }
/** Simulated seconds per real second. At ×1000 a low orbit takes about 5 s and a geostationary one 86 s. */
const TIME_WARPS = [1, 10, 100, 1000, 10000, 100000] as const
const DEFAULT_WARP = 1000
/** Longest real step between frames (s), so a tab left in the background does not jump ahead. */
const MAX_FRAME = 0.25
const EQUAL_AREA_SECTORS = 8

type Pt = [number, number]
const pathOf = (points: Pt[], close = false) =>
  points.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('') + (close ? 'Z' : '')

/** An arc of `radius` px around `center` from angle `from` to `to` (screen radians, y down). */
function arc(center: Pt, radius: number, from: number, to: number, samples = 24): Pt[] {
  return Array.from({ length: samples + 1 }, (_, k) => {
    const t = from + ((to - from) * k) / samples
    return [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)] as Pt
  })
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h >= 48) return `${formatValue(seconds / 86400, 2)} d`
  return [h && `${h} h`, (h || m) && `${m} min`, !h && `${s % 60} s`].filter(Boolean).join(' ')
}

/** About the widest an apsis label gets (px), e.g. "vp 10.01 km/s". */
const LABEL_WIDTH = 90

/** "vₚ 10.01 km/s" with a real subscript: the Unicode subscript letters are missing from many fonts. */
function SpeedLabel({ sub, value }: { sub: string; value: string }) {
  return (
    <>
      <tspan className="font-serif italic">v</tspan>
      <tspan dy="3" fontSize="8">
        {sub}
      </tspan>
      <tspan dy="-3"> {value}</tspan>
    </>
  )
}

const MAP_W = 400
const MAP_H = 200
/** With J2 on, the 3D view also shows the orbit this many days later, so the slow drift is visible at a glance. */
const J2_PREVIEW_DAYS = 30

/** An angle difference in (−180°, 180°]. */
const angleDiff = (to: number, from: number) => ((((to - from + 180) % 360) + 360) % 360) - 180

/** How many orbits a ground track shows at a time. */
const TRACK_ORBITS = 3

/**
 * The ground track on a longitude–latitude grid: three orbits at a time, the part already flown solid and the rest
 * dashed. The track is computed once per three orbits, not per frame; only the satellite's dot moves.
 */
function GroundTrackView({
  epoch,
  body,
  elapsed,
  j2,
  rotationAtStart,
}: {
  epoch: OrbitalElements
  body: CentralBody
  elapsed: number
  j2: boolean
  /** The prime meridian's angle from the reference direction when the clock starts (deg). */
  rotationAtStart: number
}) {
  const period = 2 * Math.PI * Math.sqrt(epoch.a ** 3 / body.mu)
  const span = TRACK_ORBITS * period
  const window = Math.floor(elapsed / span)
  const track = useMemo(
    () =>
      groundTrack(epoch, body, window * span, (window + 1) * span, 120 * TRACK_ORBITS, j2, rotationAtStart),
    [epoch, body, window, span, j2, rotationAtStart],
  )
  const now = subSatellitePoint(epoch, body, elapsed, j2, rotationAtStart)
  // Land outlines for Earth, loaded only when a ground track is shown (about 10 kB compressed).
  const [land, setLand] = useState<string | null>(null)
  useEffect(() => {
    if (body.key !== 'earth') return setLand(null)
    let live = true
    import('./world-land').then((m) => live && setLand(m.LAND_PATH))
    return () => {
      live = false
    }
  }, [body.key])
  const x = (lon: number) => ((lon + 180) / 360) * MAP_W
  const y = (lat: number) => ((90 - lat) / 180) * MAP_H
  // Split where the track wraps from +180° to −180°, and where the flown part ends.
  const flown = Math.round(((elapsed - window * span) / span) * (track.length - 1))
  const lines = (points: typeof track) => {
    const out: Pt[][] = [[]]
    points.forEach((p, k) => {
      const prev = points[k - 1]
      if (prev && Math.abs(p.lon - prev.lon) > 180) out.push([])
      ;(out[out.length - 1] as Pt[]).push([x(p.lon), y(p.lat)])
    })
    return out.filter((l) => l.length > 1)
  }
  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="block h-auto w-full" aria-hidden="true">
      <rect width={MAP_W} height={MAP_H} fill="var(--color-surface-2)" />
      {land && (
        <path
          data-land
          d={land}
          transform={`scale(${MAP_W / 360} ${MAP_H / 180})`}
          fill="var(--color-line-soft)"
          stroke="var(--color-line-strong)"
          strokeWidth={0.4}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lon) => (
        <line
          key={`m${lon}`}
          x1={x(lon)}
          x2={x(lon)}
          y1={0}
          y2={MAP_H}
          stroke="var(--color-line-strong)"
          strokeOpacity={lon === 0 ? 1 : 0.5}
        />
      ))}
      {[-60, -30, 0, 30, 60].map((lat) => (
        <line
          key={`p${lat}`}
          x1={0}
          x2={MAP_W}
          y1={y(lat)}
          y2={y(lat)}
          stroke="var(--color-line-strong)"
          strokeOpacity={lat === 0 ? 1 : 0.5}
        />
      ))}
      {[-60, -30, 0, 30, 60].map((lat) => (
        <text key={`lp${lat}`} x={3} y={y(lat) - 2} className="fill-muted text-[8px]">
          {lat === 0 ? '0°' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`}
        </text>
      ))}
      {[-120, -60, 0, 60, 120].map((lon) => (
        <text key={`lm${lon}`} x={x(lon) + 2} y={MAP_H - 3} className="fill-muted text-[8px]">
          {lon === 0 ? '0°' : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`}
        </text>
      ))}
      {lines(track.slice(0, flown + 1)).map((l) => (
        <path
          key={`f${l[0]?.join()}`}
          d={pathOf(l)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.6}
        />
      ))}
      {lines(track.slice(flown)).map((l) => (
        <path
          key={`n${l[0]?.join()}`}
          d={pathOf(l)}
          fill="none"
          stroke="var(--color-accent)"
          strokeOpacity={0.45}
          strokeWidth={1.2}
          strokeDasharray="4 3"
        />
      ))}
      <circle
        data-subsatellite={`${now.lat.toFixed(2)},${now.lon.toFixed(2)}`}
        cx={x(now.lon)}
        cy={y(now.lat)}
        r={5}
        fill="var(--color-ai)"
        stroke="var(--color-surface)"
        strokeWidth={2}
      />
    </svg>
  )
}

/** The orbit in its own plane: focus at the body, periapsis to the right. */
function PlaneView({
  el,
  radius,
  mu,
  showAreas,
  speeds,
}: {
  el: OrbitalElements
  radius: number
  mu: number
  showAreas: boolean
  /** Speeds (km/s) now and at the apsides, for scaling and labelling the velocity arrows. */
  speeds: { v?: number; vp?: number; va?: number }
}) {
  const { t } = useTranslation()
  const arrow = useId()
  const { a, e } = el
  const nu = toRad(el.nu)
  const rp = a * (1 - e)
  const ra = a * (1 + e)
  const b = a * Math.sqrt(1 - e * e)
  const xmin = Math.min(-ra, -radius)
  const xmax = Math.max(rp, radius)
  const ymax = Math.max(b, radius)
  // Wide side margins leave room for the apsis labels outside the orbit.
  const [mx, my] = [70, 30]
  const scale = Math.min((SIZE - 2 * mx) / (xmax - xmin), (PLANE_HEIGHT - 2 * my) / (2 * ymax))
  const ox = (SIZE - (xmax + xmin) * scale) / 2
  const oy = PLANE_HEIGHT / 2
  const toScreen = ([x, y]: Pt): Pt => [ox + x * scale, oy - y * scale]

  // The orbit's shape only changes with a and e (and the scale), not as the satellite moves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: toScreen is derived from these values
  const ellipse = useMemo(
    () => Array.from({ length: 181 }, (_, k) => toScreen(perifocalPosition(a, e, (2 * Math.PI * k) / 180))),
    [a, e, scale, ox],
  )
  const sat = toScreen(perifocalPosition(a, e, nu))
  const focus: Pt = [ox, oy]
  const [vx, vy] = perifocalVelocity(a, e, nu, mu)
  const vLen = Math.hypot(vx, vy)
  // The arrow's length is the speed: longest at periapsis, where the satellite is fastest.
  const vpSpeed = speeds.vp ?? vLen
  const length = speedArrowLength(vLen, vpSpeed)
  const vTip: Pt = [sat[0] + (vx / vLen) * length, sat[1] - (vy / vLen) * length]
  const kms = (v: number | undefined) => (v === undefined ? '' : `${formatValue(v, 2)} km/s`)
  const gamma = Math.atan2(e * Math.sin(nu), 1 + e * Math.cos(nu))
  // Local horizontal (perpendicular to r, in the direction of motion), as a screen angle.
  const horizontal = -(nu + Math.PI / 2)
  // biome-ignore lint/correctness/useExhaustiveDependencies: toScreen is derived from these values
  const sectors = useMemo(
    () =>
      showAreas
        ? Array.from({ length: EQUAL_AREA_SECTORS }, (_, k) => {
            const from = meanToTrue((2 * Math.PI * k) / EQUAL_AREA_SECTORS, e)
            const to = meanToTrue((2 * Math.PI * (k + 1)) / EQUAL_AREA_SECTORS, e)
            return sweptSector(a, e, from, to).map((p) => toScreen(p))
          })
        : [],
    [showAreas, a, e, scale, ox],
  )
  const bodyPx = Math.max(radius * scale, 3)
  const showApsides = e >= 0.01

  return (
    <svg viewBox={`0 0 ${SIZE} ${PLANE_HEIGHT}`} className="block h-auto w-full" aria-hidden="true">
      <defs>
        <marker
          id={arrow}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="var(--color-ai)" />
        </marker>
      </defs>
      {sectors.map((sector, k) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: sectors are positional
          key={k}
          d={pathOf(sector, true)}
          fill={k % 2 ? 'var(--color-accent-soft)' : 'var(--color-ai-soft)'}
          stroke="var(--color-surface)"
          strokeWidth={1}
        />
      ))}
      <line
        x1={toScreen([-ra, 0])[0]}
        x2={toScreen([rp, 0])[0]}
        y1={oy}
        y2={oy}
        stroke="var(--color-line-strong)"
        strokeDasharray="4 4"
      />
      <path d={pathOf(ellipse)} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
      <circle cx={focus[0]} cy={focus[1]} r={bodyPx} fill="var(--color-line-strong)" />
      {showApsides && (
        <>
          {/* The speeds at the apsides, drawn to the same scale as the satellite's arrow. */}
          {(
            [
              [rp, -1, speeds.vp],
              [-ra, 1, speeds.va],
            ] as const
          ).map(([x, dir, speed]) =>
            speed === undefined ? null : (
              <line
                key={x}
                data-apsis-speed={speed}
                x1={toScreen([x, 0])[0]}
                y1={oy}
                x2={toScreen([x, 0])[0]}
                y2={oy + dir * speedArrowLength(speed, vpSpeed)}
                stroke="var(--color-ai)"
                strokeOpacity={0.45}
                strokeWidth={1.5}
                strokeDasharray="3 2"
                markerEnd={`url(#${arrow})`}
              />
            ),
          )}
          <circle cx={toScreen([rp, 0])[0]} cy={oy} r={4} fill="var(--color-accent)" />
          {/* Right-aligned to the edge when the periapsis is close to it, so the labels stay inside. */}
          {(() => {
            const x = toScreen([rp, 0])[0] + 8
            const fits = x + LABEL_WIDTH <= SIZE - 4
            const at = { x: fits ? x : SIZE - 4, textAnchor: fits ? 'start' : 'end' } as const
            return (
              <>
                <text {...at} y={oy + 16} className="fill-muted text-[12px]">
                  {t('orbit.periapsis')}
                </text>
                <text {...at} y={oy + 30} className="fill-ink text-[11px]">
                  <SpeedLabel sub="p" value={kms(speeds.vp)} />
                </text>
              </>
            )
          })()}
          <circle cx={toScreen([-ra, 0])[0]} cy={oy} r={4} fill="var(--color-accent)" />
          <text x={toScreen([-ra, 0])[0] - 8} y={oy - 22} textAnchor="end" className="fill-muted text-[12px]">
            {t('orbit.apoapsis')}
          </text>
          <text x={toScreen([-ra, 0])[0] - 8} y={oy - 8} textAnchor="end" className="fill-ink text-[11px]">
            <SpeedLabel sub="a" value={kms(speeds.va)} />
          </text>
        </>
      )}
      {/* True anomaly, measured at the focus from periapsis. */}
      {el.nu > 1 && (
        <>
          <path d={pathOf(arc(focus, bodyPx + 18, 0, -nu))} fill="none" stroke="var(--color-ink-2)" />
          <text
            x={focus[0] + (bodyPx + 30) * Math.cos(-nu / 2)}
            y={focus[1] + (bodyPx + 30) * Math.sin(-nu / 2)}
            dy="0.32em"
            textAnchor="middle"
            className="fill-ink font-serif text-[14px] italic"
          >
            ν
          </text>
        </>
      )}
      <line
        x1={focus[0]}
        y1={focus[1]}
        x2={sat[0]}
        y2={sat[1]}
        stroke="var(--color-ink-2)"
        strokeWidth={1.5}
      />
      <text
        x={(focus[0] + sat[0]) / 2}
        y={(focus[1] + sat[1]) / 2 - 8}
        textAnchor="middle"
        className="fill-ink font-serif text-[14px] italic"
      >
        r
      </text>
      {Math.abs(toDeg(gamma)) > 1 && (
        <path
          d={pathOf(arc(sat, 20, horizontal, horizontal + gamma))}
          fill="none"
          stroke="var(--color-ink-2)"
        />
      )}
      <line
        data-speed-arrow={length.toFixed(1)}
        x1={sat[0]}
        y1={sat[1]}
        x2={vTip[0]}
        y2={vTip[1]}
        stroke="var(--color-ai)"
        strokeWidth={2}
        markerEnd={`url(#${arrow})`}
      />
      <text
        x={vTip[0]}
        y={vTip[1] - 8}
        textAnchor="middle"
        className="fill-ink font-serif text-[14px] italic"
      >
        v
      </text>
      <circle
        cx={sat[0]}
        cy={sat[1]}
        r={6}
        fill="var(--color-ai)"
        stroke="var(--color-surface)"
        strokeWidth={2}
      />
    </svg>
  )
}

/** The orbit in 3D against the reference plane, with the angles that place it there. */
function SpaceView({
  el,
  radius,
  view,
  onRotate,
  later,
}: {
  el: OrbitalElements
  radius: number
  view: ViewAngles
  onRotate: (view: ViewAngles) => void
  /** The orbit some time later (J2 drift), drawn faintly with its ascending node. */
  later?: OrbitalElements | null
}) {
  const { t } = useTranslation()
  const drag = useRef<{ x: number; y: number; view: ViewAngles } | null>(null)
  const ra = el.a * (1 + el.e)
  const plane = Math.max(ra * 1.15, radius * 1.6)
  const scale = (SIZE / 2 - 24) / plane
  const toScreen = (p: Vec3): Pt => {
    const q = project(p, view)
    return [SIZE / 2 + q.x * scale, SIZE / 2 + q.y * scale]
  }
  // The half of the orbit on the far side of the reference plane is drawn dashed, under the plane.
  const viewerSide = view.pitch >= 0 ? 1 : -1
  // The orbit's shape only changes with the elements other than ν (with J2, Ω and ω drift slowly).
  // biome-ignore lint/correctness/useExhaustiveDependencies: ν, which changes every frame, does not change the path
  const path = useMemo(() => orbitPath({ ...el, nu: 0 }, 240), [el.a, el.e, el.i, el.raan, el.argp])
  const near: Pt[][] = []
  const far: Pt[][] = []
  let current: Pt[] = []
  let currentNear: boolean | null = null
  for (const p of path) {
    const isNear = p[2] * viewerSide >= 0
    if (currentNear !== null && isNear !== currentNear) {
      current.push(toScreen(p))
      ;(currentNear ? near : far).push(current)
      current = []
    }
    currentNear = isNear
    current.push(toScreen(p))
  }
  if (current.length) (currentNear ? near : far).push(current)

  const planeRing = arc([0, 0], plane, 0, 2 * Math.PI, 72).map(([x, y]) => toScreen([x, y, 0]))
  // biome-ignore lint/correctness/useExhaustiveDependencies: the drifted orbit only changes with its own shape
  const laterPath = useMemo(
    () => (later ? orbitPath({ ...later, nu: 0 }, 180) : null),
    [later?.a, later?.e, later?.i, later?.raan, later?.argp],
  )
  const laterNode = later
    ? perifocalToInertial(later, perifocalPosition(later.a, later.e, -toRad(later.argp)))
    : null
  const raan = toRad(el.raan)
  // The orbit's point at argument of latitude u (angle from the ascending node), i.e. true anomaly u − ω.
  const pointAt = (u: number) => perifocalToInertial(el, perifocalPosition(el.a, el.e, u - toRad(el.argp)))
  const ascending = pointAt(0)
  const descending = pointAt(Math.PI)
  const periapsis = perifocalToInertial(el, perifocalPosition(el.a, el.e, 0))
  const sat = perifocalToInertial(el, perifocalPosition(el.a, el.e, toRad(el.nu)))
  const inclined = el.i > 0.5 && el.i < 179.5
  const r0 = plane * 0.32
  // Ω: in the reference plane, from the x-axis to the ascending node.
  const raanArc = Array.from({ length: 25 }, (_, k): Vec3 => {
    const t2 = (raan * k) / 24
    return [r0 * Math.cos(t2), r0 * Math.sin(t2), 0]
  })
  // ω: in the orbit plane, from the ascending node to periapsis.
  const argpArc = Array.from(
    { length: 25 },
    (_, k): Vec3 =>
      perifocalToInertial({ ...el, argp: 0 }, [
        r0 * 0.8 * Math.cos((toRad(el.argp) * k) / 24),
        r0 * 0.8 * Math.sin((toRad(el.argp) * k) / 24),
      ]),
  )
  // i: at the ascending node, from the reference plane up to the orbit plane. Both directions are
  // perpendicular to the line of nodes, i apart; interpolate between them on the unit circle.
  const nodeRadius = Math.hypot(...ascending)
  const inPlane: Vec3 = [-Math.sin(raan), Math.cos(raan), 0]
  const inOrbit = perifocalToInertial({ ...el, argp: 0 }, [0, 1])
  const inc = toRad(el.i)
  const iArc = Array.from({ length: 17 }, (_, k): Vec3 => {
    const t2 = (inc * k) / 16
    const [wa, wb] = [Math.sin(inc - t2) / Math.sin(inc), Math.sin(t2) / Math.sin(inc)]
    const d = nodeRadius * 0.28
    return [0, 1, 2].map((c) => ascending[c as 0] + (inPlane[c as 0] * wa + inOrbit[c as 0] * wb) * d) as Vec3
  })
  const label = (p: Vec3, text: string, className = 'fill-ink font-serif text-[14px] italic') => {
    const [x, y] = toScreen(p)
    return (
      <text x={x} y={y} dy="0.32em" textAnchor="middle" className={className}>
        {text}
      </text>
    )
  }
  const mid = <T,>(list: T[]) => list[Math.floor(list.length / 2)] as T

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, view }
  }
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const start = drag.current
    if (!start) return
    onRotate({
      yaw: start.view.yaw - (e.clientX - start.x) * 0.5,
      pitch: Math.max(-89, Math.min(89, start.view.pitch + (e.clientY - start.y) * 0.5)),
    })
  }

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="block h-auto w-full cursor-grab touch-none active:cursor-grabbing"
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        drag.current = null
      }}
    >
      {far.map((seg) => (
        <path
          key={`far${seg[0]?.join()}`}
          d={pathOf(seg)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          opacity={0.6}
        />
      ))}
      <path
        d={pathOf(planeRing, true)}
        fill="var(--color-surface-2)"
        fillOpacity={0.75}
        stroke="var(--color-line-strong)"
      />
      {(
        [
          [[plane, 0, 0], 'x'],
          [[0, plane, 0], 'y'],
          [[0, 0, plane * 0.85], 'z'],
        ] as [Vec3, string][]
      ).map(([tip, name]) => {
        const [x1, y1] = toScreen([0, 0, 0])
        const [x2, y2] = toScreen(tip)
        return (
          <g key={name}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-line-strong)" />
            {label([tip[0] * 1.07, tip[1] * 1.07, tip[2] * 1.07], name, 'fill-muted text-[12px]')}
          </g>
        )
      })}
      <circle cx={SIZE / 2} cy={SIZE / 2} r={Math.max(radius * scale, 3)} fill="var(--color-line-strong)" />
      {laterPath && (
        <path
          data-j2-later
          d={pathOf(laterPath.map(toScreen), true)}
          fill="none"
          stroke="var(--color-ai)"
          strokeOpacity={0.55}
          strokeWidth={1.2}
          strokeDasharray="2 3"
        />
      )}
      {laterNode && (
        <circle
          cx={toScreen(laterNode)[0]}
          cy={toScreen(laterNode)[1]}
          r={3}
          fill="none"
          stroke="var(--color-ai)"
          strokeWidth={1.5}
        />
      )}
      {near.map((seg) => (
        <path
          key={`near${seg[0]?.join()}`}
          d={pathOf(seg)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
        />
      ))}
      {inclined && (
        <>
          <line
            x1={toScreen(ascending)[0]}
            y1={toScreen(ascending)[1]}
            x2={toScreen(descending)[0]}
            y2={toScreen(descending)[1]}
            stroke="var(--color-muted)"
            strokeDasharray="2 3"
          />
          {label([ascending[0] * 1.12, ascending[1] * 1.12, 0], '☊', 'fill-ink text-[15px]')}
          {label([descending[0] * 1.12, descending[1] * 1.12, 0], '☋', 'fill-ink text-[15px]')}
          {el.raan > 1 && (
            <>
              <path d={pathOf(raanArc.map(toScreen))} fill="none" stroke="var(--color-ink-2)" />
              {label(mid(raanArc).map((c) => c * 1.25) as Vec3, 'Ω')}
            </>
          )}
          <path d={pathOf(iArc.map(toScreen))} fill="none" stroke="var(--color-ink-2)" />
          {/* Outside the arc, so the label clears the ☊ marker at the node. */}
          {label(
            [0, 1, 2].map((c) => ascending[c as 0] + (mid(iArc)[c as 0] - ascending[c as 0]) * 1.7) as Vec3,
            'i',
          )}
        </>
      )}
      {el.e >= 0.01 && el.argp > 1 && inclined && (
        <>
          <path d={pathOf(argpArc.map(toScreen))} fill="none" stroke="var(--color-ink-2)" />
          {label(mid(argpArc).map((c) => c * 1.3) as Vec3, 'ω')}
        </>
      )}
      {el.e >= 0.01 && (
        <circle cx={toScreen(periapsis)[0]} cy={toScreen(periapsis)[1]} r={4} fill="var(--color-accent)" />
      )}
      <circle
        cx={toScreen(sat)[0]}
        cy={toScreen(sat)[1]}
        r={6}
        fill="var(--color-ai)"
        stroke="var(--color-surface)"
        strokeWidth={2}
      />
      <title>{t('orbit.dragToRotate')}</title>
    </svg>
  )
}

function ElementField({
  id,
  symbol,
  label,
  unit,
  value,
  min,
  max,
  step,
  log = false,
  onChange,
}: {
  id: string
  symbol: string
  label: string
  unit?: string
  value: number
  min: number
  max: number
  step: number
  log?: boolean
  onChange: (value: number) => void
}) {
  // A logarithmic slider for the semi-major axis, which spans low orbits to beyond the Moon.
  const toSlider = (v: number) => (log ? Math.log(Math.min(Math.max(v, min), max)) : v)
  const fromSlider = (v: number) => (log ? Math.round(Math.exp(v)) : v)
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-[13px] font-semibold">
        <span className="font-serif text-[15px] italic">{symbol}</span>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="range"
          aria-label={label}
          min={log ? Math.log(min) : min}
          max={log ? Math.log(max) : max}
          step={log ? 0.001 : step}
          value={toSlider(value)}
          onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
          className="min-w-0 flex-1 accent-accent"
        />
        <span className="flex w-32 items-center overflow-hidden rounded-[10px] border border-line-strong bg-surface focus-within:outline-2 focus-within:outline-accent">
          <input
            id={id}
            type="number"
            step={step}
            value={Number.isFinite(value) ? value : ''}
            onChange={(e) => {
              const n = Number.parseFloat(e.target.value)
              if (Number.isFinite(n)) onChange(n)
            }}
            className="h-9 min-w-0 flex-1 border-0 bg-transparent px-2 font-mono text-[14px] outline-none"
          />
          {unit && <span className="pr-2 font-mono text-xs text-muted">{unit}</span>}
        </span>
      </div>
    </div>
  )
}

/**
 * `value`, updated at most every `ms` milliseconds (at once when `ms` is 0). While the orbit plays, the values table
 * and the element fields follow at 10 Hz instead of 60, which is plenty to read and leaves the frame to the views.
 */
function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value)
  const last = useRef(0)
  useEffect(() => {
    if (ms === 0) return
    const wait = last.current + ms - performance.now()
    const update = () => {
      last.current = performance.now()
      setShown(value)
    }
    if (wait <= 0) return update()
    const timer = setTimeout(update, wait)
    return () => clearTimeout(timer)
  }, [value, ms])
  return ms === 0 ? value : shown
}

const clampElements = (el: OrbitalElements): OrbitalElements => ({
  a: Math.max(el.a, 1),
  e: Math.min(Math.max(el.e, 0), MAX_ECCENTRICITY),
  i: Math.min(Math.max(el.i, 0), 180),
  raan: ((el.raan % 360) + 360) % 360,
  argp: ((el.argp % 360) + 360) % 360,
  nu: ((el.nu % 360) + 360) % 360,
})

/** The six element fields. Memoised: while the orbit plays they follow the throttled orbit, not every frame. */
const ElementFields = memo(function ElementFields({
  el,
  body,
  onSet,
}: {
  el: OrbitalElements
  body: CentralBody
  onSet: (patch: Partial<OrbitalElements>) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  return (
    <div className="grid gap-x-6 gap-y-3 @xl:grid-cols-2">
      <ElementField
        id={`${id}-a`}
        symbol="a"
        label={t('orbit.a')}
        unit="km"
        value={el.a}
        min={Math.round(body.radius * 1.02)}
        max={Math.round(body.radius * 70)}
        step={1}
        log
        onChange={(a) => onSet({ a })}
      />
      <ElementField
        id={`${id}-e`}
        symbol="e"
        label={t('orbit.e')}
        value={el.e}
        min={0}
        max={MAX_ECCENTRICITY}
        step={0.001}
        onChange={(e) => onSet({ e })}
      />
      <ElementField
        id={`${id}-i`}
        symbol="i"
        label={t('orbit.i')}
        unit="°"
        value={el.i}
        min={0}
        max={180}
        step={0.1}
        onChange={(i) => onSet({ i })}
      />
      <ElementField
        id={`${id}-raan`}
        symbol="Ω"
        label={t('orbit.raan')}
        unit="°"
        value={Math.round(el.raan * 100) / 100}
        min={0}
        max={360}
        step={0.1}
        onChange={(raan) => onSet({ raan })}
      />
      <ElementField
        id={`${id}-argp`}
        symbol="ω"
        label={t('orbit.argp')}
        unit="°"
        value={Math.round(el.argp * 100) / 100}
        min={0}
        max={360}
        step={0.1}
        onChange={(argp) => onSet({ argp })}
      />
      <ElementField
        id={`${id}-nu`}
        symbol="ν"
        label={t('orbit.nu')}
        unit="°"
        value={Math.round(el.nu * 10) / 10}
        min={0}
        max={360}
        step={0.1}
        onChange={(nu) => onSet({ nu })}
      />
    </div>
  )
})

const valueRow = (label: string, value: string) => (
  <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line-soft py-1.5">
    <dt className="text-[13px] text-muted">{label}</dt>
    <dd className="m-0 font-mono text-[14px]">{value}</dd>
  </div>
)

/** The derived values, from the orbit calculator. Memoised like the element fields. */
const DerivedValues = memo(function DerivedValues({
  results,
  q,
  body,
  all,
  j2,
}: {
  results: Record<string, number>
  q: ReturnType<typeof orbitQuantities>
  body: CentralBody
  /** Every value, or the key ones with a "More values" button. */
  all: boolean
  /** Show the J2 drift rates among the key values. */
  j2: boolean
}) {
  const { t } = useTranslation()
  const [more, setMore] = useState(false)
  const row = valueRow
  const out = (key: string) => {
    const o = ORBIT_CALCULATOR.outputs.find((x) => x.key === key)
    const v = results[key]
    if (!o || v === undefined) return null
    // Drift rates are small: fixed decimals read better than 4.0112e-4.
    const text = o.unit === 'deg/day' ? formatFixed(v, o.precision ?? 4) : formatValue(v, o.precision ?? 3)
    return row(t(`orbit.out.${key}`), `${text} ${o.unit ?? ''}`)
  }
  const periapsisAltitude = row(t('orbit.periapsisAltitude'), `${formatValue(q.rp - body.radius, 1)} km`)
  const apoapsisAltitude = row(t('orbit.apoapsisAltitude'), `${formatValue(q.ra - body.radius, 1)} km`)
  const period = row(t('orbit.period'), formatDuration(q.period))
  if (!all && !more)
    return (
      <div className="flex flex-col gap-2">
        <dl className="m-0 grid gap-x-8 @xl:grid-cols-2">
          <div>
            {periapsisAltitude}
            {apoapsisAltitude}
            {period}
          </div>
          <div>
            {out('v')}
            {out('vp')}
            {out('va')}
            {j2 && out('dOmega')}
            {/* A nearly circular orbit has no clear periapsis, so its drift means little there. */}
            {j2 && (q.ra - q.rp) / (q.ra + q.rp) >= 0.01 && out('domega')}
          </div>
        </dl>
        <button
          type="button"
          className="cursor-pointer self-start text-sm font-semibold text-accent"
          aria-expanded={false}
          onClick={() => setMore(true)}
        >
          {t('orbit.moreValues')}
        </button>
      </div>
    )
  return (
    <div className="flex flex-col gap-2">
      <dl className="m-0 grid gap-x-8 @xl:grid-cols-2">
        <div>
          {out('rp')}
          {periapsisAltitude}
          {out('ra')}
          {apoapsisAltitude}
          {out('p')}
          {period}
        </div>
        <div>
          {out('r')}
          {out('v')}
          {out('vp')}
          {out('va')}
          {out('vcirc')}
          {out('vesc')}
          {out('dOmega')}
          {out('domega')}
          {out('gamma')}
          {row(t('orbit.sincePeriapsis'), formatDuration(q.sincePeriapsis))}
          {out('h')}
          {out('eps')}
        </div>
      </dl>
      {!all && (
        <button
          type="button"
          className="cursor-pointer self-start text-sm font-semibold text-accent"
          aria-expanded
          onClick={() => setMore(false)}
        >
          {t('orbit.fewerValues')}
        </button>
      )}
    </div>
  )
})

/**
 * An interactive orbit diagram. Readers can change the elements, animate the motion and rotate the view;
 * in an editor, `onSave` stores the current elements as the block's starting orbit.
 */
export function OrbitView({
  body: initialBody,
  elements: initialElements,
  view: initialView,
  onSave,
  allValues = false,
}: {
  body: string
  elements: OrbitalElements
  view?: ViewAngles
  onSave?: (attrs: { body: string; elements: OrbitalElements; view: ViewAngles }) => void
  /** Show every derived value at once (the standalone viewer); pages show the key ones and "More values". */
  allValues?: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [bodyKey, setBodyKey] = useState(initialBody)
  /** The orbit when the simulated clock last started; the orbit shown is computed from it and the elapsed time. */
  const [epoch, setEpoch] = useState(initialElements)
  const [view, setView] = useState(initialView ?? DEFAULT_VIEW)
  const [playing, setPlaying] = useState(false)
  const [warp, setWarp] = useState<number>(DEFAULT_WARP)
  /** Simulated time since the orbit was last changed by hand (s). */
  const [elapsed, setElapsed] = useState(0)
  const [showAreas, setShowAreas] = useState(false)
  const [j2, setJ2] = useState(false)
  const [showTrack, setShowTrack] = useState(false)
  /** When the clock starts, as a UTC date and time (datetime-local value): fixes Earth's rotation, so ground-track
   * longitudes are real. Set to the current time when the ground track is first shown. */
  const [trackStart, setTrackStart] = useState('')
  const body = bodyByKey(bodyKey)
  const rotationAtStart = useMemo(() => {
    if (body.key !== 'earth' || !trackStart) return 0
    const date = new Date(`${trackStart}:00Z`)
    return Number.isNaN(date.getTime()) ? 0 : greenwichSiderealAngle(date)
  }, [body.key, trackStart])
  const el = useMemo(() => propagate(epoch, body, elapsed, j2), [epoch, body, elapsed, j2])
  const display = useThrottled(el, playing ? 100 : 0)
  // With J2: where the orbit will be in a month, and how far it has drifted since the clock started.
  const later = useMemo(
    () => (j2 ? propagate(display, body, J2_PREVIEW_DAYS * 86400, true) : null),
    [j2, display, body],
  )
  const q = useMemo(() => orbitQuantities(display, body.mu), [display, body.mu])
  // The orbit calculator's formulas in plain code (tested to agree), so the diagram does not load math.js.
  const results = useMemo(() => orbitValues(display, body), [display, body])
  // The readout follows every frame: vis-viva from the live orbit.
  const liveSpeed = Math.sqrt(body.mu * (2 / orbitQuantities(el, body.mu).r - 1 / el.a))
  // Changing the orbit by hand (or the model) restarts the simulated clock from the orbit as it is now.
  const restart = (next: OrbitalElements) => {
    setEpoch(next)
    setElapsed(0)
  }
  const elNow = useRef(el)
  elNow.current = el
  // Stable, so the memoised element fields do not re-render on every frame.
  const setFields = useCallback((patch: Partial<OrbitalElements>) => {
    setEpoch(clampElements({ ...elNow.current, ...patch }))
    setElapsed(0)
  }, [])
  const warpRef = useRef(warp)
  warpRef.current = warp

  useEffect(() => {
    setEpoch(initialElements)
    setBodyKey(initialBody)
    setElapsed(0)
  }, [initialElements, initialBody])

  // Animate on a simulated clock (real time × warp). The orbit shown is computed from the epoch orbit and the
  // elapsed time (steady mean anomaly, plus J2 drift when on), so orbits keep their true periods relative to each
  // other, the satellite speeds up near periapsis, and long runs do not accumulate error.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, MAX_FRAME) * warpRef.current
      last = now
      setElapsed((s) => s + dt)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  // Only changes made by hand count: playing moves the satellite (and with J2 the orbit) but is not an edit,
  // so the epoch orbit is what is compared and saved.
  const dirty =
    bodyKey !== initialBody ||
    (Object.keys(epoch) as (keyof OrbitalElements)[]).some(
      (k) => Math.abs(epoch[k] - initialElements[k]) > 1e-9,
    )
  const row = valueRow

  return (
    // Sized by its own width: in a page column the two views stack, in the wide viewer they sit side by side.
    <div className="@container flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
          {t('orbit.body')}
          <select
            className={`${inputCls} min-w-36`}
            value={bodyKey}
            onChange={(e) => {
              setBodyKey(e.target.value)
              restart(el)
            }}
          >
            {CENTRAL_BODIES.map((b) => (
              <option key={b.key} value={b.key}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {bodyKey === 'earth' && (
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
            {t('orbit.preset')}
            <select
              className={`${inputCls} min-w-48`}
              value=""
              onChange={(e) => {
                const preset = ORBIT_PRESETS.find((p) => p.key === e.target.value)
                if (preset) restart({ ...preset.elements })
              }}
            >
              <option value="">{t('orbit.choosePreset')}</option>
              {ORBIT_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="flex-1" />
        <Button
          size="sm"
          variant={playing ? 'primary' : 'secondary'}
          aria-pressed={playing}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? t('orbit.pause') : t('orbit.play')}
        </Button>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
          {t('orbit.timeWarp')}
          <select className={inputCls} value={warp} onChange={(e) => setWarp(Number(e.target.value))}>
            {TIME_WARPS.map((w) => (
              <option key={w} value={w}>
                {w === 1 ? t('orbit.realTime') : `×${w.toLocaleString()}`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-[18px] w-[18px] accent-accent"
            checked={showAreas}
            onChange={(e) => setShowAreas(e.target.checked)}
          />
          {t('orbit.equalAreas')}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-[18px] w-[18px] accent-accent"
            checked={j2}
            onChange={(e) => {
              setJ2(e.target.checked)
              restart(el)
            }}
          />
          {t('orbit.j2')}
        </label>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-[18px] w-[18px] accent-accent"
            checked={showTrack}
            onChange={(e) => {
              setShowTrack(e.target.checked)
              if (e.target.checked && !trackStart) setTrackStart(new Date().toISOString().slice(0, 16))
            }}
          />
          {t('orbit.groundTrack')}
        </label>
      </div>

      {/* Updated every frame while playing, so it is not announced to screen readers on each change. */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-[10px] bg-surface-2 px-4 py-2 font-mono text-[14px]">
        <span>
          <span className="font-sans text-[13px] text-muted">{t('orbit.speedNow')} </span>
          <span data-testid="orbit-speed">
            {Number.isFinite(liveSpeed) ? `${formatValue(liveSpeed, 3)} km/s` : '—'}
          </span>
        </span>
        <span>
          <span className="font-sans text-[13px] text-muted">{t('orbit.elapsed')} </span>
          <span data-testid="orbit-elapsed">{formatDuration(elapsed)}</span>
        </span>
        {j2 && (
          <span data-testid="orbit-drift">
            <span className="font-sans text-[13px] text-muted">{t('orbit.driftSinceStart')} </span>
            ΔΩ {formatFixed(angleDiff(el.raan, epoch.raan), 2)}°
            {el.e >= 0.01 && <> · Δω {formatFixed(angleDiff(el.argp, epoch.argp), 2)}°</>}
          </span>
        )}
      </div>

      <div className="grid items-start gap-4 @3xl:grid-cols-2">
        <figure className="m-0 flex flex-col gap-1.5 rounded-[10px] border border-line-soft bg-surface p-2">
          <PlaneView
            el={el}
            radius={body.radius}
            mu={body.mu}
            showAreas={showAreas}
            speeds={{ v: results.v, vp: results.vp, va: results.va }}
          />
          <figcaption className="px-2 pb-1 text-[13px] text-muted">
            {showAreas ? t('orbit.equalAreasCaption', { n: EQUAL_AREA_SECTORS }) : t('orbit.planeCaption')}
          </figcaption>
        </figure>
        <figure className="m-0 flex flex-col gap-1.5 rounded-[10px] border border-line-soft bg-surface p-2">
          <SpaceView el={el} radius={body.radius} view={view} onRotate={setView} later={later} />
          <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1 text-[13px] text-muted">
            <span className="flex-1">
              {t('orbit.spaceCaption')}
              {j2 && <> {t('orbit.j2Caption', { days: J2_PREVIEW_DAYS })}</>}
            </span>
            <label className="flex items-center gap-1.5">
              {t('orbit.turn')}
              <input
                type="range"
                min={-180}
                max={180}
                value={((((view.yaw + 180) % 360) + 360) % 360) - 180}
                onChange={(e) => setView((v) => ({ ...v, yaw: Number(e.target.value) }))}
                className="w-20 accent-accent"
              />
            </label>
            <label className="flex items-center gap-1.5">
              {t('orbit.tilt')}
              <input
                type="range"
                min={-89}
                max={89}
                value={view.pitch}
                onChange={(e) => setView((v) => ({ ...v, pitch: Number(e.target.value) }))}
                className="w-20 accent-accent"
              />
            </label>
          </figcaption>
        </figure>
      </div>

      {showTrack && (
        <figure className="m-0 flex w-full max-w-[720px] flex-col gap-1.5 self-center rounded-[10px] border border-line-soft bg-surface p-2">
          <GroundTrackView
            epoch={epoch}
            body={body}
            elapsed={elapsed}
            j2={j2}
            rotationAtStart={rotationAtStart}
          />
          <figcaption className="px-2 pb-1 text-[13px] text-muted">
            {body.key === 'earth' ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1">{t('orbit.trackCaptionEarth', { n: TRACK_ORBITS })}</span>
                <label className="flex items-center gap-1.5">
                  {t('orbit.trackStart')}
                  <input
                    type="datetime-local"
                    className={`${inputCls} h-9 py-0`}
                    value={trackStart}
                    onChange={(e) => {
                      setTrackStart(e.target.value)
                      setElapsed(0)
                      setEpoch(elNow.current)
                    }}
                  />
                </label>
              </span>
            ) : (
              t('orbit.trackCaption', { n: TRACK_ORBITS, body: body.name })
            )}
          </figcaption>
        </figure>
      )}

      <ElementFields el={display} body={body} onSet={setFields} />

      {q.rp < body.radius && (
        <p role="alert" className="m-0 rounded-[10px] bg-danger-soft px-4 py-2.5 text-sm text-danger">
          {t('orbit.belowSurface', { body: body.name })}
        </p>
      )}

      <DerivedValues results={results} q={q} body={body} all={allValues} j2={j2} />

      {onSave && dirty && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-accent-soft px-4 py-3">
          <span className="flex-1 text-sm">{t('orbit.unsaved')}</span>
          <Button
            size="sm"
            onClick={() => {
              restart(initialElements)
              setBodyKey(initialBody)
            }}
          >
            {t('orbit.reset')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => onSave({ body: bodyKey, elements: epoch, view })}
          >
            {t('orbit.save')}
          </Button>
        </div>
      )}
    </div>
  )
}
