import type { DocJSON, Page, PageType } from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { type Editor, EditorContent, type JSONContent, useEditor, useEditorState } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDrop } from '../components/FileDrop'
import { BackIcon, ListIcon } from '../components/Icons'
import { editorExtensions } from '../components/extensions'
import { ErrorNote, Field, btn, inputCls } from '../components/ui'
import { ApiError, api } from '../lib/api'

const TYPES: PageType[] = ['lecture', 'note', 'seminar', 'source']

export function Toolbar({ editor }: { editor: Editor }) {
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
        className={`${btn('ghost', 'sm')} border border-[#C7D0F2] bg-accent-soft text-accent`}
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

function EditorScreen({ page, defaultCourseId }: { page: Page | null; defaultCourseId?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const editable = courses.data?.filter((c) => c.role !== 'viewer') ?? []
  const [title, setTitle] = useState(page?.title ?? '')
  const [courseId, setCourseId] = useState(page?.courseId ?? defaultCourseId ?? '')
  const [type, setType] = useState<PageType>(page?.type ?? 'lecture')
  const [tags, setTags] = useState(page?.tags.join(', ') ?? '')
  const [aiVisible, setAiVisible] = useState(page?.aiVisible ?? true)
  const [message, setMessage] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!courseId && editable[0]) setCourseId(editable[0].id)
  }, [courseId, editable])

  const editor = useEditor({
    extensions: editorExtensions,
    content: (page?.content ?? { type: 'doc', content: [{ type: 'paragraph' }] }) as JSONContent,
    immediatelyRender: true,
    editorProps: { attributes: { 'aria-label': 'Page content', class: 'min-h-[50vh]' } },
    onUpdate: () => setDirty(true),
  })

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: title.trim() || t('common.untitled'),
        type,
        tags: tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        aiVisible,
        content: (editor?.getJSON() ?? { type: 'doc' }) as DocJSON,
      }
      return page
        ? api.pages.update(page.id, { ...body, baseRevision: page.revision, message: message || undefined })
        : api.pages.create({ ...body, courseId })
    },
    onSuccess: (saved) => {
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['pages'] })
      qc.invalidateQueries({ queryKey: ['formulas'] })
      qc.setQueryData(['page', saved.id], saved)
      navigate({ to: '/pages/$pageId', params: { pageId: saved.id } })
    },
  })
  const conflict = save.error instanceof ApiError && save.error.status === 409

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line bg-surface px-6 py-3.5 md:px-8">
        <Link
          to={page ? '/pages/$pageId' : '/wiki'}
          params={page ? { pageId: page.id } : undefined}
          aria-label={t('editor.preview')}
          className="flex h-11 w-11 items-center justify-center rounded-[10px] text-ink hover:bg-line-soft"
        >
          <BackIcon size={20} />
        </Link>
        <span className="font-semibold">{page ? page.title : t('nav.newPage')}</span>
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
          <span className={`h-2 w-2 rounded-full ${dirty ? 'bg-ai-on-dark' : 'bg-ok'}`} />
          {save.isPending ? t('editor.saving') : dirty ? t('editor.unsaved') : t('editor.saved')}
        </span>
        <div className="ml-auto flex flex-wrap gap-2.5">
          <button
            type="button"
            className={btn('primary')}
            disabled={save.isPending || !courseId}
            onClick={() => save.mutate()}
          >
            {t('editor.publish')}
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-wrap items-start gap-8 p-6 md:p-8">
        <section
          aria-label="Page editor"
          className="min-w-0 flex-[999_1_560px] overflow-clip rounded-[14px] border border-line bg-surface"
        >
          {editor && <Toolbar editor={editor} />}
          <div className="mx-auto box-border flex w-full max-w-[820px] flex-col gap-5 px-6 pb-14 pt-10 md:px-14">
            <label htmlFor="page-title" className="sr-only">
              {t('editor.title')}
            </label>
            <input
              id="page-title"
              value={title}
              placeholder={t('editor.title')}
              onChange={(e) => {
                setTitle(e.target.value)
                setDirty(true)
              }}
              className="border-0 bg-transparent p-0 font-serif text-[40px] font-semibold text-ink outline-offset-4"
            />
            <EditorContent editor={editor} className="prose-nc" />
          </div>
        </section>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-6">
          {conflict && <ErrorNote error={t('editor.conflict')} />}
          {!conflict && <ErrorNote error={save.error} />}
          <section
            aria-labelledby="h-props"
            className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-surface p-5"
          >
            <h2 id="h-props" className="m-0 text-[17px] font-bold">
              {t('editor.settings')}
            </h2>
            <Field label={t('editor.course')} htmlFor="course">
              <select
                id="course"
                className={inputCls}
                value={courseId}
                disabled={!!page}
                onChange={(e) => setCourseId(e.target.value)}
              >
                {editable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('editor.type')} htmlFor="ptype">
              <select
                id="ptype"
                className={inputCls}
                value={type}
                onChange={(e) => {
                  setType(e.target.value as PageType)
                  setDirty(true)
                }}
              >
                {TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`editor.types.${x}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('editor.tags')} htmlFor="tags">
              <input
                id="tags"
                className={inputCls}
                value={tags}
                onChange={(e) => {
                  setTags(e.target.value)
                  setDirty(true)
                }}
              />
            </Field>
            {page && (
              <Field label={t('editor.message')} htmlFor="msg">
                <input
                  id="msg"
                  className={inputCls}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </Field>
            )}
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium">
              <input
                type="checkbox"
                className="h-[18px] w-[18px] accent-ai"
                checked={aiVisible}
                onChange={(e) => {
                  setAiVisible(e.target.checked)
                  setDirty(true)
                }}
              />
              {t('editor.aiVisible')}
            </label>
          </section>
          {page && (
            <section
              aria-labelledby="h-files"
              className="flex flex-col gap-3.5 rounded-[14px] border border-line bg-surface p-5"
            >
              <h2 id="h-files" className="m-0 text-[17px] font-bold">
                {t('page.files')}
              </h2>
              <FileDrop courseId={page.courseId} pageId={page.id} compact />
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

export function PageEdit() {
  const { t } = useTranslation()
  const { pageId } = useParams({ from: '/app/pages/$pageId/edit' })
  const page = useQuery({ queryKey: ['page', pageId], queryFn: () => api.pages.get(pageId) })
  if (page.isPending) return <div className="p-10 text-muted">{t('common.loading')}</div>
  if (page.error) return <div className="p-10 text-danger">{page.error.message}</div>
  return <EditorScreen key={`${page.data.id}-${page.data.revision}`} page={page.data} />
}

export function PageNew() {
  const { courseId } = useSearch({ from: '/app/pages/new' })
  return <EditorScreen page={null} defaultCourseId={courseId} />
}
