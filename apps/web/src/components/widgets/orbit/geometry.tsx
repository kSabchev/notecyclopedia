import { type ViewAngles, formatValue } from '@nc/shared'

/** Sizes, drawing helpers and labels shared by the orbit diagram views. */

export const SIZE = 400
/** The plane view is wider than tall: orbits are ellipses, and a fixed height keeps the page still while e changes. */
export const PLANE_HEIGHT = 300
export const DEFAULT_VIEW: ViewAngles = { yaw: -35, pitch: 25 }
/** Simulated seconds per real second. At ×1000 a low orbit takes about 5 s and a geostationary one 86 s. */
export const TIME_WARPS = [1, 10, 100, 1000, 10000, 100000] as const
export const DEFAULT_WARP = 1000
/** Longest real step between frames (s), so a tab left in the background does not jump ahead. */
export const MAX_FRAME = 0.25
export const EQUAL_AREA_SECTORS = 8

export type Pt = [number, number]
export const pathOf = (points: Pt[], close = false) =>
  points.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('') + (close ? 'Z' : '')

/** An arc of `radius` px around `center` from angle `from` to `to` (screen radians, y down). */
export function arc(center: Pt, radius: number, from: number, to: number, samples = 24): Pt[] {
  return Array.from({ length: samples + 1 }, (_, k) => {
    const t = from + ((to - from) * k) / samples
    return [center[0] + radius * Math.cos(t), center[1] + radius * Math.sin(t)] as Pt
  })
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h >= 48) return `${formatValue(seconds / 86400, 2)} d`
  return [h && `${h} h`, (h || m) && `${m} min`, !h && `${s % 60} s`].filter(Boolean).join(' ')
}

/** About the widest an apsis label gets (px), e.g. "vp 10.01 km/s". */
export const LABEL_WIDTH = 90

/** "vₚ 10.01 km/s" with a real subscript: the Unicode subscript letters are missing from many fonts. */
export function SpeedLabel({ sub, value }: { sub: string; value: string }) {
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

export const MAP_W = 400
export const MAP_H = 200
/** With J2 on, the 3D view also shows the orbit this many days later, so the slow drift is visible at a glance. */
export const J2_PREVIEW_DAYS = 30

/** An angle difference in (−180°, 180°]. */
export const angleDiff = (to: number, from: number) => ((((to - from + 180) % 360) + 360) % 360) - 180

/** How many orbits a ground track shows at a time. */
export const TRACK_ORBITS = 3
