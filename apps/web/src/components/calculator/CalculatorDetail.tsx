import {
  type Calculator,
  type CalculatorReview,
  type CalculatorSpec,
  checkCalculator,
  inputToConstant,
  parseCalculatorJson,
} from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../../lib/api'
import { CalculatorRunner } from '../CalculatorRunner'
import { Connections } from '../Connections'
import { LectureLabel } from '../LectureLinks'
import { ErrorNote, Eyebrow, btn, inputCls } from '../ui'
import { AutomaticChecks, ReviewPanel } from './CalculatorChecks'

import { ReworkForm } from './CalculatorChecks'
import { SpecEditor } from './SpecEditor'

const TEMPLATE: CalculatorSpec = {
  version: 1,
  name: 'New calculator',
  inputs: [
    { key: 'v0', label: 'Initial speed', unit: 'm/s', default: 10 },
    { key: 'a', label: 'Acceleration', unit: 'm/s²', default: 2 },
    { key: 't', label: 'Time', unit: 's', default: 3 },
  ],
  outputs: [{ key: 'v', label: 'Final speed', unit: 'm/s', expr: 'v0 + a * t' }],
}

export function CalculatorDetail({
  calc,
  isNew,
  onCancelNew,
}: { calc: Calculator | null; isNew: boolean; onCancelNew: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const [editing, setEditing] = useState(isNew)
  const [text, setText] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [visualSpec, setVisualSpec] = useState<CalculatorSpec>(calc?.spec ?? TEMPLATE)
  const [courseId, setCourseId] = useState<string | null>(calc?.courseId ?? null)
  const [lecture, setLecture] = useState(calc?.lectureNumber ? String(calc.lectureNumber) : '')
  /** The spec being edited, and its JSON text (the advanced editor). */
  const setSpec = (next: CalculatorSpec) => {
    setVisualSpec(next)
    setText(JSON.stringify(next, null, 2))
  }
  const lectureNumber = courseId && lecture.trim() ? Number(lecture) : null
  const lectureValid = lectureNumber === null || (Number.isSafeInteger(lectureNumber) && lectureNumber > 0)
  const [review, setReview] = useState<CalculatorReview | null>(null)
  const [reviewKind, setReviewKind] = useState<'check' | 'rework'>('check')
  const [reworking, setReworking] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [applied, setApplied] = useState(false)
  const library = useQuery({ queryKey: ['calculators'], queryFn: api.calculators.list })
  const copiedFrom = calc?.copiedFromId ? library.data?.find((c) => c.id === calc.copiedFromId) : undefined
  useEffect(() => {
    const initialSpec = calc?.spec ?? TEMPLATE
    setText(JSON.stringify(initialSpec, null, 2))
    setVisualSpec(initialSpec)
    setAdvanced(false)
    setEditing(isNew)
    setCourseId(calc?.courseId ?? null)
    setLecture(calc?.lectureNumber ? String(calc.lectureNumber) : '')
    setReview(null)
    setReworking(false)
    setInstructions('')
    setApplied(false)
  }, [calc, isNew])

  const parsed = parseCalculatorJson(text)
  const spec = editing ? visualSpec : calc?.spec
  const issues = useMemo(() => (spec ? checkCalculator(spec) : []), [spec])
  const check = useMutation({
    mutationFn: () => api.ai.reviewCalculator(calc?.id ?? ''),
    onSuccess: (r) => {
      setReview(r)
      setReviewKind('check')
    },
  })
  // Rework with AI: one call on request, shown as changes like the check, nothing saved until Save.
  const rework = useMutation({
    mutationFn: () => api.ai.reworkCalculator(calc?.id ?? '', instructions.trim()),
    onSuccess: (r) => {
      setReview(r)
      setReviewKind('rework')
      setReworking(false)
    },
  })
  const archive = useMutation({
    mutationFn: (archived: boolean) => api.calculators.archive(calc?.id ?? '', archived),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calculators'] }),
  })
  const duplicate = useMutation({
    mutationFn: () => api.calculators.duplicate(calc?.id ?? ''),
    onSuccess: (copy) => {
      qc.invalidateQueries({ queryKey: ['calculators'] })
      navigate({ to: '/calculators/$calcId', params: { calcId: copy.id } })
    },
  })
  // A proposed correction goes into the editor, where it can be changed before saving.
  const applyReview = (revised: CalculatorSpec) => {
    setSpec(revised)
    setAdvanced(false)
    setEditing(true)
    setReview(null)
    setApplied(true)
  }
  const updateSpec = (update: (current: CalculatorSpec) => CalculatorSpec) => {
    const next = update(visualSpec)
    setSpec(next)
  }
  // An input that is really a constant (such as μ) becomes one, in the editor, to review and save.
  const makeConstant = (key: string) => {
    const next = inputToConstant(editing ? visualSpec : (calc?.spec ?? visualSpec), key)
    setSpec(next)
    setAdvanced(false)
    setEditing(true)
  }
  const save = useMutation({
    mutationFn: () => {
      if (!parsed.spec) throw new Error(t('calc.invalid'))
      if (!lectureValid) throw new Error(t('calc.lectureHint'))
      return calc
        ? api.calculators.update(calc.id, { spec: parsed.spec, courseId, lectureNumber })
        : api.calculators.create({ spec: parsed.spec, courseId, lectureNumber })
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['calculators'] })
      setEditing(false)
      navigate({ to: '/calculators/$calcId', params: { calcId: c.id } })
    },
  })
  const remove = useMutation({
    mutationFn: () => api.calculators.remove(calc?.id ?? ''),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calculators'] })
      navigate({ to: '/calculators' })
    },
  })

  return (
    <section
      aria-labelledby="h-calc"
      className="flex min-w-0 flex-[2_1_540px] flex-col overflow-hidden rounded-[16px] border border-line bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-calc" className="m-0 text-[22px] font-bold">
            {spec?.name ?? calc?.name ?? t('calc.new')}
          </h2>
          {spec?.description && <span className="text-sm text-muted">{spec.description}</span>}
          {calc?.courseId && (
            <span className="flex flex-wrap gap-x-2 text-sm font-semibold text-muted">
              <Link to="/courses/$courseId" params={{ courseId: calc.courseId }} className="text-muted">
                {courses.data?.find((c) => c.id === calc.courseId)?.name ?? t('connect.subject')}
              </Link>
              {calc.lectureNumber != null && (
                <>
                  <span aria-hidden>·</span>
                  <LectureLabel courseId={calc.courseId} n={calc.lectureNumber} className="text-muted" />
                </>
              )}
            </span>
          )}
          {calc?.sourcePageId && (
            <Link to="/pages/$pageId" params={{ pageId: calc.sourcePageId }} className="text-sm">
              ↗ source
            </Link>
          )}
          {copiedFrom && (
            <Link to="/calculators/$calcId" params={{ calcId: copiedFrom.id }} className="text-sm">
              {t('calc.copyOf', { name: copiedFrom.name })}
            </Link>
          )}
          {calc?.archivedAt && (
            <span className="text-sm font-semibold text-muted">{t('calc.archivedNote')}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <button
                type="button"
                className={btn('secondary', 'sm')}
                onClick={() => {
                  setApplied(false)
                  if (!calc) return onCancelNew()
                  setSpec(calc.spec)
                  setEditing(false)
                }}
              >
                {t('calc.cancel')}
              </button>
              <button
                type="button"
                className={btn('primary', 'sm')}
                disabled={!parsed.spec || save.isPending}
                onClick={() => save.mutate()}
              >
                {t('calc.save')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={btn('ai', 'sm')}
                disabled={check.isPending}
                onClick={() => check.mutate()}
              >
                {check.isPending ? t('calc.review.running') : t('calc.review.button')}
              </button>
              <button
                type="button"
                className={btn('ai', 'sm')}
                aria-expanded={reworking}
                onClick={() => setReworking((value) => !value)}
              >
                {t('calc.rework')}
              </button>
              <button type="button" className={btn('secondary', 'sm')} onClick={() => setEditing(true)}>
                {t('calc.edit')}
              </button>
              <button
                type="button"
                className={btn('secondary', 'sm')}
                disabled={duplicate.isPending}
                onClick={() => duplicate.mutate()}
              >
                {t('calc.duplicate')}
              </button>
              <button
                type="button"
                className={btn('secondary', 'sm')}
                disabled={archive.isPending}
                onClick={() => archive.mutate(!calc?.archivedAt)}
              >
                {calc?.archivedAt ? t('calc.restore') : t('calc.archive')}
              </button>
              <button
                type="button"
                className={btn('danger', 'sm')}
                onClick={() => window.confirm(`${t('calc.delete')}?`) && remove.mutate()}
              >
                {t('calc.delete')}
              </button>
            </>
          )}
        </div>
      </div>

      {spec ? (
        <CalculatorRunner spec={spec} />
      ) : (
        <div className="p-6">
          <ErrorNote error={parsed.error} />
        </div>
      )}

      <AutomaticChecks issues={issues} onMakeConstant={calc || editing ? makeConstant : undefined} />
      {reworking && calc && !editing && (
        <ReworkForm
          instructions={instructions}
          onChange={setInstructions}
          onSubmit={() => rework.mutate()}
          pending={rework.isPending}
          onCancel={() => setReworking(false)}
        />
      )}
      {(check.error || rework.error || archive.error || duplicate.error) && (
        <div className="border-t border-line px-6 py-4">
          <ErrorNote error={check.error ?? rework.error ?? archive.error ?? duplicate.error} />
        </div>
      )}
      {review && calc && !editing && (
        <ReviewPanel
          review={review}
          current={calc.spec}
          onApply={applyReview}
          onDismiss={() => setReview(null)}
          title={reviewKind === 'rework' ? t('calc.reworkTitle') : undefined}
        />
      )}
      {applied && editing && (
        <p className="m-0 border-t border-line bg-ai-soft px-6 py-3 text-sm">{t('calc.review.applied')}</p>
      )}

      {editing && (
        <div className="flex flex-col gap-3 border-t border-line bg-surface-2 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              {advanced ? t('calc.definition') : t('calc.editor')}
            </span>
            <button
              type="button"
              className={btn('secondary', 'sm')}
              disabled={advanced && !parsed.spec}
              onClick={() => {
                if (advanced && parsed.spec) setVisualSpec(parsed.spec)
                setAdvanced((value) => !value)
              }}
            >
              {advanced ? t('calc.visualEditor') : t('calc.advancedEditor')}
            </button>
          </div>
          {advanced ? (
            <textarea
              id="spec"
              rows={16}
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="rounded-[10px] border border-line-strong bg-surface p-3 font-mono text-[13px]"
            />
          ) : (
            <SpecEditor
              spec={visualSpec}
              update={updateSpec}
              onMakeConstant={makeConstant}
              courseId={courseId}
            />
          )}
          {parsed.error && <ErrorNote error={`${t('calc.invalid')}: ${parsed.error}`} />}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="calc-course" className="text-[13px] font-semibold text-muted">
              {t('calc.shareIn')}
            </label>
            <select
              id="calc-course"
              className={`${inputCls} max-w-xs`}
              value={courseId ?? ''}
              onChange={(e) => setCourseId(e.target.value || null)}
              aria-describedby="calc-course-hint"
            >
              <option value="">{t('calc.onlyMe')}</option>
              {courses.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p id="calc-course-hint" className="m-0 text-xs text-muted">
              {t('calc.courseHint')}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="calc-lecture" className="text-[13px] font-semibold text-muted">
              {t('calc.lecture')}
            </label>
            <input
              id="calc-lecture"
              type="number"
              min={1}
              inputMode="numeric"
              className={`${inputCls} w-40`}
              disabled={!courseId}
              value={courseId ? lecture : ''}
              aria-invalid={!lectureValid}
              aria-describedby="calc-lecture-hint"
              onChange={(e) => setLecture(e.target.value)}
            />
            <p id="calc-lecture-hint" className="m-0 text-xs text-muted">
              {t(courseId ? 'calc.lectureHint' : 'calc.lectureNeedsCourse')}
            </p>
          </div>
          <ErrorNote error={save.error} />
        </div>
      )}

      {calc && !editing && (
        <div className="border-t border-line px-6 py-5">
          <Connections courseId={calc.courseId} lectureNumber={calc.lectureNumber} calculatorId={calc.id} />
        </div>
      )}
      {calc && !editing && (
        <div className="flex flex-wrap items-center gap-4 border-t border-line bg-surface-2 px-6 py-5">
          <Eyebrow>{t('calc.export')}</Eyebrow>
          {(['json', 'py', 'html', 'xlsx'] as const).map((f) => (
            <a
              key={f}
              href={api.calculators.exportUrl(calc.id, f)}
              className={`${btn('secondary', 'sm')} font-mono`}
            >
              .{f}
            </a>
          ))}
        </div>
      )}
    </section>
  )
}
