import {
  CENTRAL_BODIES,
  ORBIT_PRESETS,
  type OrbitalElements,
  type ViewAngles,
  bodyByKey,
  formatFixed,
  formatValue,
  greenwichSiderealAngle,
  orbitQuantities,
  orbitValues,
  propagate,
} from '@nc/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, inputCls } from '../ui'

import { DerivedValues, ElementFields, clampElements, useThrottled } from './orbit/ElementControls'
import { GroundTrackView } from './orbit/GroundTrackView'
import { PlaneView } from './orbit/PlaneView'
import { SpaceView } from './orbit/SpaceView'
import {
  DEFAULT_VIEW,
  DEFAULT_WARP,
  EQUAL_AREA_SECTORS,
  J2_PREVIEW_DAYS,
  MAX_FRAME,
  TIME_WARPS,
  TRACK_ORBITS,
  angleDiff,
  formatDuration,
} from './orbit/geometry'

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
