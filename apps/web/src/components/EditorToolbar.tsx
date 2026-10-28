import { useQueryClient } from '@tanstack/react-query'
import { type Editor, useEditorState } from '@tiptap/react'
import { Suspense, lazy, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { ListIcon } from './Icons'
import { ErrorNote, btn } from './ui'

const WidgetDialog = lazy(() => import('./widgets/WidgetDialog').then((m) => ({ default: m.WidgetDialog })))

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp'

/**
 * Formatting toolbar shared by the page editor and the AI review draft. Images need the page's course
 * (they are uploaded to it), so the image button only appears when `courseId` is given.
 */
export function EditorToolbar({
  editor,
  courseId,
  pageId,
}: { editor: Editor; courseId?: string; pageId?: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [inserting, setInserting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<unknown>(null)
  const picker = useRef<HTMLInputElement>(null)

  const uploadImage = async (file: File) => {
    if (!courseId) return
    setUploading(true)
    setUploadError(null)
    try {
      const [uploaded] = await api.files.upload(courseId, [file], pageId)
      if (uploaded) editor.chain().focus().insertImage({ fileId: uploaded.id, alt: file.name }).run()
      qc.invalidateQueries({ queryKey: ['files'] })
    } catch (e) {
      setUploadError(e)
    } finally {
      setUploading(false)
    }
  }

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
      <button type="button" className={btn('secondary', 'sm')} onClick={() => setInserting(true)}>
        {t('widget.calculator')}
      </button>
      {courseId && (
        <>
          <button
            type="button"
            className={btn('secondary', 'sm')}
            disabled={uploading}
            onClick={() => picker.current?.click()}
          >
            {uploading ? t('widget.uploading') : t('widget.image')}
          </button>
          <input
            ref={picker}
            type="file"
            accept={IMAGE_TYPES}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) uploadImage(file)
            }}
          />
        </>
      )}
      {uploadError ? (
        <div className="basis-full">
          <ErrorNote error={uploadError} />
        </div>
      ) : null}
      {inserting && (
        <Suspense fallback={null}>
          <WidgetDialog
            onClose={() => setInserting(false)}
            onSubmit={(attrs) => {
              editor.chain().focus().insertWidget(attrs).run()
              setInserting(false)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
