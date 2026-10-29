import {
  CENTRAL_BODIES,
  MAX_ECCENTRICITY,
  ORBIT_CALCULATOR,
  ORBIT_PRESETS,
  type OrbitalElements,
  type Vec3,
  type ViewAngles,
  bodyByKey,
  evaluateCalculator,
  formatValue,
  meanToTrue,
  orbitPath,
  orbitQuantities,
  perifocalPosition,
  perifocalToInertial,
  perifocalVelocity,
  project,
  sweptSector,
  toDeg,
  toRad,
  trueToMean,
} from '@nc/shared'
import { type PointerEvent as ReactPointerEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, inputCls } from '../ui'

const SIZE = 400
/** The plane view is wider than tall: orbits are ellipses, and a fixed height keeps the page still while e changes. */
const PLANE_HEIGHT = 300
const DEFAULT_VIEW: ViewAngles = { yaw: -35, pitch: 25 }
/** Real seconds for one animated orbit. */
const SECONDS_PER_ORBIT = 12
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

/** The orbit in its own plane: focus at the body, periapsis to the right. */
function PlaneView({
  el,
  radius,
  mu,
  showAreas,
}: {
  el: OrbitalElements
  radius: number
  mu: number
  showAreas: boolean
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

  const ellipse = Array.from({ length: 181 }, (_, k) =>
    toScreen(perifocalPosition(a, e, (2 * Math.PI * k) / 180)),
  )
  const sat = toScreen(perifocalPosition(a, e, nu))
  const focus: Pt = [ox, oy]
  const [vx, vy] = perifocalVelocity(a, e, nu, mu)
  const vLen = Math.hypot(vx, vy)
  const vTip: Pt = [sat[0] + (vx / vLen) * 46, sat[1] - (vy / vLen) * 46]
  const gamma = Math.atan2(e * Math.sin(nu), 1 + e * Math.cos(nu))
  // Local horizontal (perpendicular to r, in the direction of motion), as a screen angle.
  const horizontal = -(nu + Math.PI / 2)
  const sectors = showAreas
    ? Array.from({ length: EQUAL_AREA_SECTORS }, (_, k) => {
        const from = meanToTrue((2 * Math.PI * k) / EQUAL_AREA_SECTORS, e)
        const to = meanToTrue((2 * Math.PI * (k + 1)) / EQUAL_AREA_SECTORS, e)
        return sweptSector(a, e, from, to).map((p) => toScreen(p))
      })
    : []
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
          <circle cx={toScreen([rp, 0])[0]} cy={oy} r={4} fill="var(--color-accent)" />
          <text x={toScreen([rp, 0])[0] + 8} y={oy - 8} className="fill-muted text-[12px]">
            {t('orbit.periapsis')}
          </text>
          <circle cx={toScreen([-ra, 0])[0]} cy={oy} r={4} fill="var(--color-accent)" />
          <text x={toScreen([-ra, 0])[0] - 8} y={oy - 8} textAnchor="end" className="fill-muted text-[12px]">
            {t('orbit.apoapsis')}
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
}: {
  el: OrbitalElements
  radius: number
  view: ViewAngles
  onRotate: (view: ViewAngles) => void
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
  const path = orbitPath(el, 240)
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

const clampElements = (el: OrbitalElements): OrbitalElements => ({
  a: Math.max(el.a, 1),
  e: Math.min(Math.max(el.e, 0), MAX_ECCENTRICITY),
  i: Math.min(Math.max(el.i, 0), 180),
  raan: ((el.raan % 360) + 360) % 360,
  argp: ((el.argp % 360) + 360) % 360,
  nu: ((el.nu % 360) + 360) % 360,
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
}: {
  body: string
  elements: OrbitalElements
  view?: ViewAngles
  onSave?: (attrs: { body: string; elements: OrbitalElements; view: ViewAngles }) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const [bodyKey, setBodyKey] = useState(initialBody)
  const [el, setEl] = useState(initialElements)
  const [view, setView] = useState(initialView ?? DEFAULT_VIEW)
  const [playing, setPlaying] = useState(false)
  const [showAreas, setShowAreas] = useState(false)
  const body = bodyByKey(bodyKey)
  const q = orbitQuantities(el, body.mu)
  const calc = useMemo(
    () => evaluateCalculator(ORBIT_CALCULATOR, { a: el.a, ecc: el.e, nu: el.nu, mu: body.mu }),
    [el.a, el.e, el.nu, body.mu],
  )
  const set = (patch: Partial<OrbitalElements>) => setEl((cur) => clampElements({ ...cur, ...patch }))

  useEffect(() => {
    setEl(initialElements)
    setBodyKey(initialBody)
  }, [initialElements, initialBody])

  // Animate at a steady mean anomaly, so the satellite speeds up near periapsis as Kepler's second law says.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setEl((cur) => {
        const M = trueToMean(toRad(cur.nu), cur.e) + (2 * Math.PI * dt) / SECONDS_PER_ORBIT
        return { ...cur, nu: toDeg(meanToTrue(M, cur.e)) }
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const dirty =
    bodyKey !== initialBody ||
    (Object.keys(el) as (keyof OrbitalElements)[]).some((k) => Math.abs(el[k] - initialElements[k]) > 1e-9)
  const results = calc.ok ? calc.values : {}
  const row = (label: string, value: string) => (
    <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line-soft py-1.5">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="m-0 font-mono text-[14px]">{value}</dd>
    </div>
  )
  const out = (key: string) => {
    const o = ORBIT_CALCULATOR.outputs.find((x) => x.key === key)
    const v = results[key]
    return o && v !== undefined
      ? row(t(`orbit.out.${key}`), `${formatValue(v, o.precision ?? 3)} ${o.unit ?? ''}`)
      : null
  }

  return (
    // Sized by its own width: in a page column the two views stack, in the wide viewer they sit side by side.
    <div className="@container flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
          {t('orbit.body')}
          <select
            className={`${inputCls} min-w-36`}
            value={bodyKey}
            onChange={(e) => setBodyKey(e.target.value)}
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
                if (preset) setEl({ ...preset.elements })
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

      <div className="grid items-start gap-4 @3xl:grid-cols-2">
        <figure className="m-0 flex flex-col gap-1.5 rounded-[10px] border border-line-soft bg-surface p-2">
          <PlaneView el={el} radius={body.radius} mu={body.mu} showAreas={showAreas} />
          <figcaption className="px-2 pb-1 text-[13px] text-muted">
            {showAreas ? t('orbit.equalAreasCaption', { n: EQUAL_AREA_SECTORS }) : t('orbit.planeCaption')}
          </figcaption>
        </figure>
        <figure className="m-0 flex flex-col gap-1.5 rounded-[10px] border border-line-soft bg-surface p-2">
          <SpaceView el={el} radius={body.radius} view={view} onRotate={setView} />
          <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1 text-[13px] text-muted">
            <span className="flex-1">{t('orbit.spaceCaption')}</span>
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
          onChange={(a) => set({ a })}
        />
        <ElementField
          id={`${id}-e`}
          symbol="e"
          label={t('orbit.e')}
          value={el.e}
          min={0}
          max={MAX_ECCENTRICITY}
          step={0.001}
          onChange={(e) => set({ e })}
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
          onChange={(i) => set({ i })}
        />
        <ElementField
          id={`${id}-raan`}
          symbol="Ω"
          label={t('orbit.raan')}
          unit="°"
          value={el.raan}
          min={0}
          max={360}
          step={0.1}
          onChange={(raan) => set({ raan })}
        />
        <ElementField
          id={`${id}-argp`}
          symbol="ω"
          label={t('orbit.argp')}
          unit="°"
          value={el.argp}
          min={0}
          max={360}
          step={0.1}
          onChange={(argp) => set({ argp })}
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
          onChange={(nu) => set({ nu })}
        />
      </div>

      {q.rp < body.radius && (
        <p role="alert" className="m-0 rounded-[10px] bg-danger-soft px-4 py-2.5 text-sm text-danger">
          {t('orbit.belowSurface', { body: body.name })}
        </p>
      )}

      <dl className="m-0 grid gap-x-8 @xl:grid-cols-2">
        <div>
          {out('rp')}
          {row(t('orbit.periapsisAltitude'), `${formatValue(q.rp - body.radius, 1)} km`)}
          {out('ra')}
          {row(t('orbit.apoapsisAltitude'), `${formatValue(q.ra - body.radius, 1)} km`)}
          {out('p')}
          {row(t('orbit.period'), formatDuration(q.period))}
        </div>
        <div>
          {out('r')}
          {out('v')}
          {out('gamma')}
          {row(t('orbit.sincePeriapsis'), formatDuration(q.sincePeriapsis))}
          {out('h')}
          {out('eps')}
        </div>
      </dl>

      {onSave && dirty && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-accent-soft px-4 py-3">
          <span className="flex-1 text-sm">{t('orbit.unsaved')}</span>
          <Button
            size="sm"
            onClick={() => {
              setEl(initialElements)
              setBodyKey(initialBody)
            }}
          >
            {t('orbit.reset')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => onSave({ body: bodyKey, elements: el, view })}>
            {t('orbit.save')}
          </Button>
        </div>
      )}
    </div>
  )
}
