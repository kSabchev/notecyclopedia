import { type CentralBody, type OrbitalElements, groundTrack, subSatellitePoint } from '@nc/shared'
import { useEffect, useMemo, useState } from 'react'

import { MAP_H, MAP_W, type Pt, TRACK_ORBITS, pathOf } from './geometry'

/**
 * The ground track on a longitude–latitude grid: three orbits at a time, the part already flown solid and the rest
 * dashed. The track is computed once per three orbits, not per frame; only the satellite's dot moves.
 */
export function GroundTrackView({
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
    import('../world-land').then((m) => live && setLand(m.LAND_PATH))
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
