import { type PlotPoint, formatValue } from '@nc/shared'
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react'

export interface PlotSeries {
  key: string
  label: string
  unit?: string
  /** Position in the fixed categorical order; colour follows the output, not its rank in this chart. */
  slot: number
}

const HEIGHT = 240
const MARGIN = { top: 12, right: 16, bottom: 40, left: 60 }
const END_LABEL_WIDTH = 104
/** End labels closer than this (px) would collide; the legend and tooltip carry identity instead. */
const MIN_LABEL_GAP = 16

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumSignificantDigits: 3 })
const tickLabel = (n: number) => (Math.abs(n) < 1e-9 ? '0' : compact.format(n))
export const seriesColor = (slot: number) => `var(--color-series-${(slot % 4) + 1})`

/** Round tick values spanning [min, max]. */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min]
  const raw = (max - min) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * magnitude >= raw) ?? 10) * magnitude
  const ticks: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(v)
  return ticks
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

/** A line chart of calculator outputs (sharing one unit) against a swept input. */
export function PlotChart({
  points,
  series,
  xLabel,
  title,
}: {
  points: PlotPoint[]
  series: PlotSeries[]
  xLabel: string
  title: string
}) {
  const { ref, width } = useWidth()
  const [hover, setHover] = useState<number | null>(null)

  const layout = useMemo(() => {
    const values = points.flatMap((p) => series.map((s) => p.y[s.key])).filter((v): v is number => v != null)
    const first = points[0]?.x ?? 0
    const last = points.at(-1)?.x ?? 1
    let lo = Math.min(...values)
    let hi = Math.max(...values)
    if (!values.length) [lo, hi] = [0, 1]
    else if (lo === hi) [lo, hi] = [lo - Math.abs(lo || 1) * 0.5, hi + Math.abs(hi || 1) * 0.5]
    const pad = (hi - lo) * 0.06
    const yTicks = niceTicks(lo - pad, hi + pad)
    const yMin = Math.min(lo - pad, yTicks[0] ?? lo)
    const yMax = Math.max(hi + pad, yTicks.at(-1) ?? hi)

    // End labels only when there are several series and they would not collide.
    const ends = series.map((s) => {
      const lastPoint = [...points].reverse().find((p) => p.y[s.key] != null)
      return { s, value: lastPoint?.y[s.key] ?? null }
    })
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
    const yPx = (v: number) => MARGIN.top + plotHeight - ((v - yMin) / (yMax - yMin || 1)) * plotHeight
    const endYs = ends.filter((e) => e.value != null).map((e) => yPx(e.value as number))
    const sorted = [...endYs].sort((a, b) => a - b)
    const labelsFit =
      series.length > 1 &&
      width > 420 &&
      sorted.every((y, i) => i === 0 || y - (sorted[i - 1] as number) >= MIN_LABEL_GAP)
    const right = MARGIN.right + (labelsFit ? END_LABEL_WIDTH : 0)
    const plotWidth = Math.max(width - MARGIN.left - right, 40)
    const xPx = (v: number) => MARGIN.left + ((v - first) / (last - first || 1)) * plotWidth

    const paths = series.map((s) => {
      let d = ''
      let pen = false
      for (const p of points) {
        const v = p.y[s.key]
        if (v == null) {
          pen = false
          continue
        }
        d += `${pen ? 'L' : 'M'}${xPx(p.x).toFixed(1)},${yPx(v).toFixed(1)}`
        pen = true
      }
      return { s, d }
    })
    return { xPx, yPx, yTicks, xTicks: niceTicks(first, last), plotWidth, ends, labelsFit, paths }
  }, [points, series, width])

  const { xPx, yPx, yTicks, xTicks, plotWidth, ends, labelsFit, paths } = layout
  const plotBottom = HEIGHT - MARGIN.bottom
  const active = hover === null ? null : points[hover]
  const readout = active
    ? `${xLabel} ${formatValue(active.x, 3)}: ${series
        .map(
          (s) =>
            `${s.label} ${active.y[s.key] == null ? '–' : formatValue(active.y[s.key] as number, 3)}${s.unit ? ` ${s.unit}` : ''}`,
        )
        .join(', ')}`
    : undefined

  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1)
    setHover(Math.round(ratio * (points.length - 1)))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowRight') setHover((h) => Math.min((h ?? -1) + step, points.length - 1))
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max((h ?? points.length) - step, 0))
    else if (e.key === 'Escape') setHover(null)
    else return
    e.preventDefault()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-semibold">{title}</span>
        {series.length > 1 && (
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-muted">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded-full" style={{ background: seriesColor(s.slot) }} />
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        ref={ref}
        // The arrow keys move a reading position along x, so the chart behaves as a slider.
        role="slider"
        aria-label={`${title}. Use the left and right arrow keys to read values.`}
        aria-valuemin={points[0]?.x}
        aria-valuemax={points.at(-1)?.x}
        aria-valuenow={active?.x}
        aria-valuetext={readout}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        className="relative rounded-md focus-visible:outline-2 focus-visible:outline-accent"
      >
        <svg width={width} height={HEIGHT} aria-hidden="true" className="block overflow-visible">
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={yPx(t)}
                y2={yPx(t)}
                stroke="var(--color-line-soft)"
              />
              <text
                x={MARGIN.left - 8}
                y={yPx(t)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted text-[12px]"
              >
                {tickLabel(t)}
              </text>
            </g>
          ))}
          <line
            x1={MARGIN.left}
            x2={MARGIN.left + plotWidth}
            y1={plotBottom}
            y2={plotBottom}
            stroke="var(--color-line)"
          />
          {xTicks.map((t) => (
            <text
              key={`x${t}`}
              x={xPx(t)}
              y={plotBottom + 18}
              textAnchor="middle"
              className="fill-muted text-[12px]"
            >
              {tickLabel(t)}
            </text>
          ))}
          <text
            x={MARGIN.left + plotWidth / 2}
            y={HEIGHT - 4}
            textAnchor="middle"
            className="fill-muted text-[12px]"
          >
            {xLabel}
          </text>

          {paths.map(({ s, d }) => (
            <path
              key={s.key}
              d={d}
              fill="none"
              stroke={seriesColor(s.slot)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {labelsFit &&
            ends.map(({ s, value }) =>
              value == null ? null : (
                <text
                  key={`end-${s.key}`}
                  x={MARGIN.left + plotWidth + 8}
                  y={yPx(value)}
                  dy="0.32em"
                  className="fill-ink text-[12px]"
                >
                  {s.label}
                </text>
              ),
            )}

          {active && (
            <g pointerEvents="none">
              <line
                x1={xPx(active.x)}
                x2={xPx(active.x)}
                y1={MARGIN.top}
                y2={plotBottom}
                stroke="var(--color-line-strong)"
              />
              {series.map((s) => {
                const v = active.y[s.key]
                return v == null ? null : (
                  <circle
                    key={s.key}
                    cx={xPx(active.x)}
                    cy={yPx(v)}
                    r={4}
                    fill={seriesColor(s.slot)}
                    stroke="var(--color-surface)"
                    strokeWidth={2}
                  />
                )
              })}
            </g>
          )}
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={plotWidth}
            height={plotBottom - MARGIN.top}
            fill="transparent"
            onPointerMove={onPointer}
            onPointerDown={onPointer}
            onPointerLeave={() => setHover(null)}
          />
        </svg>

        {active && (
          <div
            className="pointer-events-none absolute top-2 z-10 flex min-w-36 flex-col gap-1 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] shadow-sm"
            style={
              xPx(active.x) > width / 2 ? { right: width - xPx(active.x) + 12 } : { left: xPx(active.x) + 12 }
            }
          >
            <span className="text-muted">
              {xLabel} {formatValue(active.x, 3)}
            </span>
            {series.map((s) => {
              const v = active.y[s.key]
              return (
                <span key={s.key} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: seriesColor(s.slot) }} />
                  <strong className="font-mono font-medium">{v == null ? '–' : formatValue(v, 3)}</strong>
                  <span className="text-muted">
                    {s.label}
                    {s.unit ? ` (${s.unit})` : ''}
                  </span>
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
