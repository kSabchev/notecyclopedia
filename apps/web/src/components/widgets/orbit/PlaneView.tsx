import {
  type OrbitalElements,
  formatValue,
  meanToTrue,
  perifocalPosition,
  perifocalVelocity,
  speedArrowLength,
  sweptSector,
  toDeg,
  toRad,
} from '@nc/shared'
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  EQUAL_AREA_SECTORS,
  LABEL_WIDTH,
  PLANE_HEIGHT,
  type Pt,
  SIZE,
  SpeedLabel,
  arc,
  pathOf,
} from './geometry'

/** The orbit in its own plane: focus at the body, periapsis to the right. */
export function PlaneView({
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
