import { type DocJSON, parsePageLink } from '@nc/shared'
import { useNavigate } from '@tanstack/react-router'
import { type MouseEvent, type ReactNode, memo } from 'react'
import {
  CalloutLabel,
  type FormulaAttrs,
  FormulaFace,
  ImageFigure,
  WidgetSlot,
  calloutCls,
  formulaBlockProps,
} from './blocks'

/** A node of a saved page document (ProseMirror JSON). */
type DocNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

/** Links keep only web, mail, phone and in-app addresses, like the editor's link mark. */
function safeHref(href: unknown): string | undefined {
  if (typeof href !== 'string') return undefined
  const value = href.trim()
  return /^(https?:|mailto:|tel:|\/|#)/i.test(value) ? value : undefined
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const noop = () => {}

function renderText(node: DocNode, key: number): ReactNode {
  let out: ReactNode = node.text ?? ''
  // The first mark is the outermost element, as in the editor.
  for (const mark of [...(node.marks ?? [])].reverse()) {
    if (mark.type === 'bold') out = <strong>{out}</strong>
    else if (mark.type === 'italic') out = <em>{out}</em>
    else if (mark.type === 'strike') out = <s>{out}</s>
    else if (mark.type === 'underline') out = <u>{out}</u>
    else if (mark.type === 'code') out = <code>{out}</code>
    else if (mark.type === 'link')
      out = (
        <a
          href={safeHref(mark.attrs?.href)}
          target={str(mark.attrs?.target) ?? '_blank'}
          rel={str(mark.attrs?.rel) ?? 'noopener noreferrer nofollow'}
        >
          {out}
        </a>
      )
  }
  return <span key={key}>{out}</span>
}

const children = (node: DocNode) => (node.content ?? []).map(renderNode)

function renderNode(node: DocNode, key: number): ReactNode {
  const a = node.attrs ?? {}
  switch (node.type) {
    case 'text':
      return node.marks?.length ? renderText(node, key) : node.text
    case 'paragraph':
      // An empty paragraph keeps its line, as in the editor.
      return <p key={key}>{node.content?.length ? children(node) : <br />}</p>
    case 'heading': {
      const level = Math.min(Math.max(Number(a.level) || 2, 1), 6)
      const Tag = `h${level}` as 'h2'
      return (
        <Tag key={key} id={str(a.id)}>
          {children(node)}
        </Tag>
      )
    }
    case 'bulletList':
      return <ul key={key}>{children(node)}</ul>
    case 'orderedList': {
      const start = Number(a.start)
      return (
        <ol key={key} start={start && start !== 1 ? start : undefined}>
          {children(node)}
        </ol>
      )
    }
    case 'listItem':
      return <li key={key}>{children(node)}</li>
    case 'blockquote':
      return <blockquote key={key}>{children(node)}</blockquote>
    case 'codeBlock':
      return (
        <pre key={key}>
          <code className={str(a.language) && `language-${a.language}`}>
            {(node.content ?? []).map((c) => c.text ?? '').join('')}
          </code>
        </pre>
      )
    case 'horizontalRule':
      return <hr key={key} />
    case 'hardBreak':
      return <br key={key} />
    case 'formula': {
      const attrs: FormulaAttrs = {
        id: str(a.id) ?? null,
        latex: str(a.latex) ?? '',
        label: str(a.label) ?? null,
        description: str(a.description) ?? null,
        pinned: a.pinned === true,
      }
      return (
        <div key={key} {...formulaBlockProps(attrs, true)} className="my-4 whitespace-normal">
          <FormulaFace attrs={attrs} reading />
        </div>
      )
    }
    case 'callout':
      return (
        <aside key={key} data-type="callout" className={calloutCls}>
          <CalloutLabel />
          <div className="min-w-0 flex-1">{children(node)}</div>
        </aside>
      )
    case 'image':
      return (
        <div key={key} className="my-5 whitespace-normal" data-type="image">
          <ImageFigure
            fileId={String(a.fileId ?? '')}
            alt={str(a.alt) ?? null}
            caption={str(a.caption) ?? null}
          />
        </div>
      )
    case 'widget':
      return (
        <div key={key} className="my-5 whitespace-normal" data-type="widget">
          <WidgetSlot attrs={a} editable={false} onChange={noop} onDelete={noop} />
        </div>
      )
    default:
      // A node this reader does not know: show its text rather than nothing.
      return node.content?.length ? <div key={key}>{children(node)}</div> : null
  }
}

/** The rendered document; memoised, so a refetch that returns an equal page does not redraw it. */
const DocBody = memo(
  function DocBody({ doc }: { doc: DocJSON }) {
    return <div className="doc-reader">{((doc.content ?? []) as DocNode[]).map(renderNode)}</div>
  },
  (prev, next) => prev.doc === next.doc || JSON.stringify(prev.doc) === JSON.stringify(next.doc),
)

/**
 * Read-only rendering of a page. It draws the saved document directly with the same blocks as the editor, so
 * reading a page does not load the editor (TipTap).
 */
export function DocView({
  doc,
  onFormula,
}: {
  doc: DocJSON
  /** Called when the reader clicks a formula block. */
  onFormula?: (formula: { nodeId: string | null; latex: string; label: string | null }) => void
}) {
  const navigate = useNavigate()
  // Links to pages and terms open inside the app (keeping the history); other links behave normally.
  const followReference = (event: MouseEvent) => {
    const formula = (event.target as HTMLElement).closest<HTMLElement>('[data-formula-node]')
    if (formula && onFormula) {
      onFormula({
        nodeId: formula.id || null,
        latex: formula.dataset.latex ?? '',
        label: formula.dataset.label ?? null,
      })
      return
    }
    const anchor = (event.target as HTMLElement).closest('a')
    const target = anchor && parsePageLink(anchor.getAttribute('href'))
    if (!target || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    navigate({ to: '/pages/$pageId', params: { pageId: target.pageId }, hash: target.nodeId ?? undefined })
  }
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: links inside are focusable and Enter on a link fires this click
    <div onClick={followReference} className="prose-nc">
      <DocBody doc={doc} />
    </div>
  )
}

/** Headings of a document, for the "On this page" list; `id` is the term id references point at. */
export function docHeadings(
  doc: DocJSON,
): { text: string; level: number; index: number; id: string | null }[] {
  const out: { text: string; level: number; index: number; id: string | null }[] = []
  ;(
    (doc.content ?? []) as {
      type: string
      attrs?: { level?: number; id?: string | null }
      content?: { text?: string }[]
    }[]
  ).forEach((n, index) => {
    if (n.type === 'heading')
      out.push({
        text: (n.content ?? []).map((c) => c.text ?? '').join(''),
        level: n.attrs?.level ?? 2,
        index,
        id: n.attrs?.id ?? null,
      })
  })
  return out
}
