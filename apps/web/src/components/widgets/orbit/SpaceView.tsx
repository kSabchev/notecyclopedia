import {
  type OrbitalElements,
  type Vec3,
  type ViewAngles,
  orbitPath,
  perifocalPosition,
  perifocalToInertial,
  project,
  toRad,
} from '@nc/shared'
import { type PointerEvent as ReactPointerEvent, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { type Pt, SIZE, arc, pathOf } from './geometry'

/** The orbit in 3D against the reference plane, with the angles that place it there. */
export function SpaceView({
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
