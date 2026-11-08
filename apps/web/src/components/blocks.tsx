import type { WidgetAttrs } from '@nc/shared'
import { type KeyboardEvent, type ReactNode, Suspense, lazy, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { Tex } from './Tex'

// The parts of the page blocks that the reader and the editor share. Nothing here imports the editor (TipTap),
// so reading a page does not load it.

export type FormulaAttrs = {
  id?: string | null
  latex: string
  label: string | null
  description: string | null
}

/**
 * Attributes of a formula block's outer element. While reading, a formula opens its card (see DocView), so it is
 * focusable and Enter does the same as a click.
 */
export function formulaBlockProps(attrs: FormulaAttrs, reading: boolean) {
  return {
    className: 'my-4',
    'data-type': 'formula',
    id: attrs.id ?? undefined,
    'data-formula-node': '',
    'data-latex': attrs.latex,
    'data-label': attrs.label ?? undefined,
    tabIndex: reading ? 0 : undefined,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (reading && e.key === 'Enter') e.currentTarget.click()
    },
  }
}

/** A formula with its description and label; `actions` and `children` are the editor's controls. */
export function FormulaFace({
  attrs,
  reading,
  open = false,
  actions,
  leading,
  onDoubleClick,
  children,
}: {
  attrs: FormulaAttrs
  reading: boolean
  open?: boolean
  actions?: ReactNode
  /** Shown in front of the formula, e.g. the reader's pin star. */
  leading?: ReactNode
  onDoubleClick?: () => void
  children?: ReactNode
}) {
  const { latex, label, description } = attrs
  return (
    <div
      className={`overflow-hidden rounded-[12px] border bg-surface font-sans ${open ? 'border-2 border-accent' : 'border-line'}`}
    >
      <div
        className={`graph-paper flex flex-col gap-1 px-5 py-4 cursor-pointer ${reading ? 'hover:bg-accent-soft' : ''}`}
        onDoubleClick={onDoubleClick}
      >
        <div className="flex items-center gap-4">
          {leading}
          <Tex latex={latex} display className="min-w-0 flex-1 overflow-x-auto text-[1.15em]" />
          {label && <span className="shrink-0 font-mono text-sm text-muted">({label})</span>}
          {actions}
        </div>
        {/* Below the formula, so a long description never squeezes it. */}
        {description && <p className="m-0 text-center text-sm text-muted">{description}</p>}
      </div>
      {children}
    </div>
  )
}

export const calloutCls =
  'my-4 flex gap-3.5 rounded-[12px] border border-note-line bg-note px-5 py-4 font-sans text-[15px]'

export function CalloutLabel() {
  const { t } = useTranslation()
  return (
    <span contentEditable={false} className="whitespace-nowrap font-bold">
      {t('editor.note')}
    </span>
  )
}

/** An uploaded image; `children` replaces the caption with the editor's controls. */
export function ImageFigure({
  fileId,
  alt,
  caption,
  outlined = false,
  children,
}: {
  fileId: string
  alt: string | null
  caption: string | null
  outlined?: boolean
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [broken, setBroken] = useState(false)
  return (
    <figure
      className={`m-0 flex flex-col gap-2 rounded-[12px] ${outlined ? 'outline-2 outline-accent' : ''}`}
    >
      {broken ? (
        <div className="rounded-[12px] border border-dashed border-line-strong p-6 text-center font-sans text-sm text-muted">
          {t('widget.imageMissing')}
        </div>
      ) : (
        <img
          src={api.files.url(fileId, true)}
          alt={alt ?? caption ?? ''}
          loading="lazy"
          onError={() => setBroken(true)}
          className="mx-auto block max-h-[70vh] max-w-full rounded-[12px] border border-line bg-surface"
        />
      )}
      {children ??
        (caption && <figcaption className="text-center font-sans text-sm text-muted">{caption}</figcaption>)}
    </figure>
  )
}

// The calculator, plot and orbit code loads only when a page contains one.
const WidgetBlock = lazy(() => import('./widgets/WidgetBlock'))

/** An embedded calculator, plot or orbit diagram, loaded on demand. */
export function WidgetSlot(props: {
  attrs: Record<string, unknown>
  editable: boolean
  onChange: (attrs: WidgetAttrs) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  return (
    <Suspense
      fallback={
        <div className="rounded-[12px] border border-line bg-surface p-5 font-sans text-sm text-muted">
          {t('common.loading')}
        </div>
      }
    >
      <WidgetBlock {...props} />
    </Suspense>
  )
}
