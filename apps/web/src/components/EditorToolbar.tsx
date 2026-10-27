import { type Editor, useEditorState } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import { ListIcon } from './Icons'
import { btn } from './ui'

/** Formatting toolbar shared by the page editor and the AI review draft. */
export function EditorToolbar({ editor }: { editor: Editor }) {
  const { t } = useTranslation()
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive('heading', { level: 2 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      callout: e.isActive('callout'),
    }),
  })
  const tb = (active: boolean) =>
    `flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg px-2 text-ink ${active ? 'bg-accent-soft text-accent' : 'hover:bg-line-soft'}`
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-line bg-surface-2 px-3 py-2"
    >
      <button
        type="button"
        aria-pressed={s.h2}
        aria-label={t('editor.heading')}
        className={`${tb(s.h2)} font-extrabold`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H
      </button>
      <button
        type="button"
        aria-pressed={s.bold}
        aria-label={t('editor.bold')}
        className={`${tb(s.bold)} font-extrabold`}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </button>
      <button
        type="button"
        aria-pressed={s.italic}
        aria-label={t('editor.italic')}
        className={`${tb(s.italic)} font-serif text-lg italic`}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        I
      </button>
      <button
        type="button"
        aria-pressed={s.bullet}
        aria-label={t('editor.list')}
        className={tb(s.bullet)}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListIcon />
      </button>
      <button
        type="button"
        aria-pressed={s.ordered}
        aria-label={t('editor.numbered')}
        className={`${tb(s.ordered)} font-mono text-sm`}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </button>
      <span className="mx-1.5 h-6 w-px bg-line" />
      <button
        type="button"
        className={`${btn('ghost', 'sm')} border border-accent bg-accent-soft text-accent`}
        onClick={() => editor.chain().focus().insertFormula().run()}
      >
        <span className="font-serif text-[17px] italic">∑</span>
        {t('editor.formula')}
      </button>
      <button
        type="button"
        aria-pressed={s.callout}
        className={`${btn('secondary', 'sm')} ${s.callout ? 'bg-note' : ''}`}
        onClick={() => editor.chain().focus().toggleCallout().run()}
      >
        {t('editor.note')}
      </button>
    </div>
  )
}
