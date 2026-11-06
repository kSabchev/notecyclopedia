import type { WidgetAttrs } from '@nc/shared'
import { Extension, Node, mergeAttributes } from '@tiptap/core'
import {
  NodeViewContent,
  NodeViewWrapper,
  type ReactNodeViewProps,
  ReactNodeViewRenderer,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CalloutLabel,
  type FormulaAttrs,
  FormulaFace,
  ImageFigure,
  WidgetSlot,
  calloutCls,
  formulaBlockProps,
} from './blocks'
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
  const { latex, label, description } = node.attrs as FormulaAttrs
  const [editing, setEditing] = useState(!latex)
  const editable = editor.isEditable
  const open = editable && (editing || (selected && !latex))

  return (
    <NodeViewWrapper {...formulaBlockProps(node.attrs as FormulaAttrs, !editable)}>
      <FormulaFace
        attrs={node.attrs as FormulaAttrs}
        reading={!editable}
        open={open}
        onDoubleClick={() => editable && setEditing(true)}
        actions={
          editable &&
          !open && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {t('page.edit')}
            </Button>
          )
        }
      >
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
      </FormulaFace>
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
  return (
    <NodeViewWrapper className={calloutCls}>
      <CalloutLabel />
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

function WidgetView({ node, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper className="my-5" data-type="widget" contentEditable={false}>
      <WidgetSlot
        attrs={node.attrs}
        editable={editor.isEditable}
        // A calculator block has no plot settings, so clear any left from a previous plot.
        onChange={(attrs) => updateAttributes({ plot: null, view: null, ...attrs })}
        onDelete={deleteNode}
      />
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
      // Orbit diagrams. Every attribute of every kind must be declared, or TipTap drops it.
      body: objectAttr,
      elements: objectAttr,
      view: objectAttr,
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
  const editable = editor.isEditable
  return (
    <NodeViewWrapper className="my-5" data-type="image" contentEditable={false}>
      <ImageFigure fileId={fileId} alt={alt} caption={caption} outlined={selected && editable}>
        {editable && (
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
        )}
      </ImageFigure>
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

/**
 * Headings keep the stable `id` the server gives them (TipTap drops undeclared attributes). It is rendered
 * as the element id, so a reference to a term (`/pages/<page>#<id>`) can scroll to it.
 */
export const HeadingIds = Extension.create({
  name: 'headingIds',
  addGlobalAttributes: () => [
    {
      types: ['heading'],
      attributes: {
        id: {
          default: null,
          parseHTML: (element) => element.getAttribute('id'),
          renderHTML: (attributes) => (attributes.id ? { id: attributes.id } : {}),
        },
      },
    },
  ],
})

export const editorExtensions = [
  StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
  Formula,
  Callout,
  Widget,
  ImageBlock,
  HeadingIds,
]
