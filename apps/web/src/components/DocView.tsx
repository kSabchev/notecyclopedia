import { type DocJSON, parsePageLink } from '@nc/shared'
import { useNavigate } from '@tanstack/react-router'
import { EditorContent, type JSONContent, useEditor } from '@tiptap/react'
import { type MouseEvent, useEffect, useRef } from 'react'
import { editorExtensions } from './extensions'

/** Read-only rendering of a page, using the same nodes as the editor. */
export function DocView({
  doc,
  onFormula,
}: {
  doc: DocJSON
  /** Called when the reader clicks a formula block. */
  onFormula?: (formula: { nodeId: string | null; latex: string; label: string | null }) => void
}) {
  const navigate = useNavigate()
  const editor = useEditor({
    extensions: editorExtensions,
    content: doc as JSONContent,
    editable: false,
    immediatelyRender: true,
  })
  // Re-render only when the page content changes: a refetch of the same page returns an equal doc,
  // and replacing the rendered nodes then would swallow a click on a link mid-way.
  const shown = useRef(JSON.stringify(doc))
  useEffect(() => {
    const next = JSON.stringify(doc)
    if (!editor || next === shown.current) return
    shown.current = next
    editor.commands.setContent(doc as JSONContent)
  }, [editor, doc])
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
    <div onClick={followReference}>
      <EditorContent editor={editor} className="prose-nc" />
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
