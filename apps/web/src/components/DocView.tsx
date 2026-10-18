import type { DocJSON } from '@nc/shared'
import { EditorContent, type JSONContent, useEditor } from '@tiptap/react'
import { useEffect } from 'react'
import { editorExtensions } from './extensions'

/** Read-only rendering of a page, using the same nodes as the editor. */
export function DocView({ doc }: { doc: DocJSON }) {
  const editor = useEditor({
    extensions: editorExtensions,
    content: doc as JSONContent,
    editable: false,
    immediatelyRender: true,
  })
  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(doc))
      editor.commands.setContent(doc as JSONContent)
  }, [editor, doc])
  return <EditorContent editor={editor} className="prose-nc" />
}

/** Headings of a document, for the "On this page" list. */
export function docHeadings(doc: DocJSON): { text: string; level: number; index: number }[] {
  const out: { text: string; level: number; index: number }[] = []
  ;(
    (doc.content ?? []) as { type: string; attrs?: { level?: number }; content?: { text?: string }[] }[]
  ).forEach((n, index) => {
    if (n.type === 'heading')
      out.push({
        text: (n.content ?? []).map((c) => c.text ?? '').join(''),
        level: n.attrs?.level ?? 2,
        index,
      })
  })
  return out
}
