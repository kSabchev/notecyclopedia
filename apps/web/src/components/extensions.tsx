import type { WidgetAttrs } from '@nc/shared'
import { Node, mergeAttributes } from '@tiptap/core'
import {
  NodeViewContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Suspense, lazy, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { Tex } from './Tex'
import { Button, inputCls } from './ui'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    formula: { insertFormula: (attrs?: { latex?: string }) => ReturnType }
    callout: { toggleCallout: () => ReturnType }
    widget: { insertWidget: (attrs: WidgetAttrs) => ReturnType }
    image: { insertImage: (attrs: { fileId: string; alt?: string }) => ReturnType }
  }
}

function FormulaView({ node, updateAttributes, deleteNode, editor, selected }: ReactNodeViewProps) {
  const { t } = useTranslation()
  const { latex, label, description, pinned } = node.attrs as {
    latex: string
    label: string | null
    description: string | null
    pinned: boolean
  }
  const [editing, setEditing] = useState(!latex)
  const editable = editor.isEditable
  const open = editable && (editing || (selected && !latex))

  return (
    <NodeViewWrapper className="my-4" data-type="formula">
      <div
        className={`overflow-hidden rounded-[12px] border bg-surface font-sans ${open ? 'border-2 border-accent' : 'border-line'}`}
      >
        <div
          className={`graph-paper flex flex-wrap items-center gap-4 px-5 py-4 ${editable ? 'cursor-pointer' : ''}`}
          onDoubleClick={() => editable && setEditing(true)}
        >
          <Tex latex={latex} display className="min-w-0 flex-1 overflow-x-auto text-[1.15em]" />
          {description && <span className="text-sm text-muted">{description}</span>}
          {label && <span className="font-mono text-sm text-muted">({label})</span>}
          {pinned && !open && (
            <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">★</span>
          )}
          {editable && !open && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {t('page.edit')}
            </Button>
          )}
        </div>
        {open && (
          <div className="flex flex-col gap-3 border-t border-line bg-surface-2 p-4" contentEditable={false}>
            <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wider text-muted">
              {t('editor.latex')}
              <textarea
                autoFocus
                rows={2}
                value={latex}
                onChange={(e) => updateAttributes({ latex: e.target.value })}
                className="rounded-lg border border-line bg-surface p-3 font-mono text-[15px] normal-case tracking-normal text-ink"
                placeholder="s = v_0 t + \tfrac{1}{2} a t^2"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
                {t('editor.label')}
                <input
                  className={`${inputCls} w-28 font-mono`}
                  value={label ?? ''}
                  onChange={(e) => updateAttributes({ label: e.target.value || null })}
                  placeholder="4.1"
                />
              </label>
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-[13px] font-semibold text-muted">
                {t('editor.description')}
                <input
                  className={inputCls}
                  value={description ?? ''}
                  onChange={(e) => updateAttributes({ description: e.target.value || null })}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-[18px] w-[18px] accent-accent"
                  checked={pinned}
                  onChange={(e) => updateAttributes({ pinned: e.target.checked })}
                />
                {t('editor.pin')}
              </label>
              <span className="flex-1" />
              <Button size="sm" variant="danger" onClick={deleteNode}>
                {t('editor.remove')}
              </Button>
              <Button size="sm" variant="primary" onClick={() => setEditing(false)}>
                {t('editor.done')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const Formula = Node.create({
  name: 'formula',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      /** Stable id assigned by the server on save; kept so other features can reference the formula. */
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-formula-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-formula-id': attrs.id } : {}),
      },
      latex: { default: '' },
      label: { default: null },
      description: { default: null },
      pinned: { default: false },
    }
  },
  parseHTML: () => [{ tag: 'div[data-type="formula"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'formula' })],
  addNodeView() {
    return ReactNodeViewRenderer(FormulaView)
  },
  addCommands() {
    return {
      insertFormula:
        (attrs = {}) =>
        ({ commands, state }) =>
          commands.insertContentAt(state.selection.to, {
            type: this.name,
            attrs: { latex: attrs.latex ?? '' },
          }),
    }
  },
})

function CalloutView() {
  const { t } = useTranslation()
  return (
    <NodeViewWrapper className="my-4 flex gap-3.5 rounded-[12px] border border-note-line bg-note px-5 py-4 font-sans text-[15px]">
      <span contentEditable={false} className="whitespace-nowrap font-bold">
        {t('editor.note')}
      </span>
      <NodeViewContent className="min-w-0 flex-1" />
    </NodeViewWrapper>
  )
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  parseHTML: () => [{ tag: 'aside[data-type="callout"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'aside',
    mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }),
    0,
  ],
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView)
  },
  addCommands() {
    return {
      toggleCallout:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    }
  },
})

// The calculator and plot code (math.js) loads only when a page contains one.
const WidgetBlock = lazy(() => import('./widgets/WidgetBlock'))

function WidgetView({ node, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  const { t } = useTranslation()
  return (
    <NodeViewWrapper className="my-5" data-type="widget" contentEditable={false}>
      <Suspense
        fallback={
          <div className="rounded-[12px] border border-line bg-surface p-5 font-sans text-sm text-muted">
            {t('common.loading')}
          </div>
        }
      >
        <WidgetBlock
          attrs={node.attrs}
          editable={editor.isEditable}
          // A calculator block has no plot settings, so clear any left from a previous plot.
          onChange={(attrs) => updateAttributes({ plot: null, ...attrs })}
          onDelete={deleteNode}
        />
      </Suspense>
    </NodeViewWrapper>
  )
}

const objectAttr = { default: null, rendered: false }

// Block commands insert after the selection: a block that was just inserted stays selected, and
// inserting over a selected block would replace it.

/** An embedded calculator or plot; see `WidgetAttrs` in @nc/shared. */
export const Widget = Node.create({
  name: 'widget',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      kind: { default: 'calculator', rendered: false },
      spec: objectAttr,
      sourceCalculatorId: objectAttr,
      plot: objectAttr,
    }
  },
  parseHTML: () => [{ tag: 'div[data-type="widget"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'widget' })],
  addNodeView() {
    return ReactNodeViewRenderer(WidgetView)
  },
  addCommands() {
    return {
      insertWidget:
        (attrs) =>
        ({ commands, state }) =>
          commands.insertContentAt(state.selection.to, { type: this.name, attrs }),
    }
  },
})

function ImageView({ node, updateAttributes, deleteNode, editor, selected }: ReactNodeViewProps) {
  const { t } = useTranslation()
  const { fileId, alt, caption } = node.attrs as {
    fileId: string
    alt: string | null
    caption: string | null
  }
  const [broken, setBroken] = useState(false)
  const editable = editor.isEditable
  return (
    <NodeViewWrapper className="my-5" data-type="image" contentEditable={false}>
      <figure
        className={`m-0 flex flex-col gap-2 rounded-[12px] ${selected && editable ? 'outline-2 outline-accent' : ''}`}
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
        {editable ? (
          <div className="flex flex-wrap items-center gap-2 font-sans">
            <input
              aria-label={t('widget.caption')}
              placeholder={t('widget.caption')}
              className={`${inputCls} min-w-48 flex-1 text-sm`}
              value={caption ?? ''}
              onChange={(e) => updateAttributes({ caption: e.target.value || null })}
            />
            <Button size="sm" variant="danger" onClick={deleteNode}>
              {t('widget.remove')}
            </Button>
          </div>
        ) : (
          caption && <figcaption className="text-center font-sans text-sm text-muted">{caption}</figcaption>
        )}
      </figure>
    </NodeViewWrapper>
  )
}

/** An image block showing an uploaded file of the page's course. */
export const ImageBlock = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      fileId: { default: null, rendered: false },
      alt: { default: null, rendered: false },
      caption: { default: null, rendered: false },
    }
  },
  parseHTML: () => [{ tag: 'figure[data-type="image"]' }],
  renderHTML: ({ HTMLAttributes }) => ['figure', mergeAttributes(HTMLAttributes, { 'data-type': 'image' })],
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
  addCommands() {
    return {
      insertImage:
        (attrs) =>
        ({ commands, state }) =>
          commands.insertContentAt(state.selection.to, { type: this.name, attrs }),
    }
  },
})

export const editorExtensions = [
  StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
  Formula,
  Callout,
  Widget,
  ImageBlock,
]
