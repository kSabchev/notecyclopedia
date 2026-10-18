import { Node, mergeAttributes } from '@tiptap/core'
import {
  NodeViewContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tex } from './Tex'
import { Button, inputCls } from './ui'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    formula: { insertFormula: (attrs?: { latex?: string }) => ReturnType }
    callout: { toggleCallout: () => ReturnType }
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
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex: attrs.latex ?? '' } }),
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

export const editorExtensions = [
  StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
  Formula,
  Callout,
]
