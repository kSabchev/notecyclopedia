import {
  type CentralBody,
  MAX_ECCENTRICITY,
  ORBIT_CALCULATOR,
  type OrbitalElements,
  formatFixed,
  formatValue,
  type orbitQuantities,
} from '@nc/shared'
import { memo, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDuration } from './geometry'

/** The element fields and derived values beside the orbit diagram. */

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
export function useThrottled<T>(value: T, ms: number): T {
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

export const clampElements = (el: OrbitalElements): OrbitalElements => ({
  a: Math.max(el.a, 1),
  e: Math.min(Math.max(el.e, 0), MAX_ECCENTRICITY),
  i: Math.min(Math.max(el.i, 0), 180),
  raan: ((el.raan % 360) + 360) % 360,
  argp: ((el.argp % 360) + 360) % 360,
  nu: ((el.nu % 360) + 360) % 360,
})

/** The six element fields. Memoised: while the orbit plays they follow the throttled orbit, not every frame. */
export const ElementFields = memo(function ElementFields({
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
export const DerivedValues = memo(function DerivedValues({
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
