import type { DocJSON, FileAsset } from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { EditorContent, type JSONContent, useEditor } from '@tiptap/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDrop } from '../components/FileDrop'
import { TrashIcon } from '../components/Icons'
import { editorExtensions } from '../components/extensions'
import { Empty, ErrorNote, FileBadge, btn, inputCls } from '../components/ui'
import { api } from '../lib/api'
import type { ArticleDraft } from '../lib/api'
import { bytes, timeAgo } from '../lib/format'
import { Toolbar } from './PageEdit'

function ArticleDraftEditor({
  file,
  draft,
  onCancel,
}: {
  file: FileAsset
  draft: ArticleDraft
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [title, setTitle] = useState(draft.title)
  const [tags, setTags] = useState(draft.tags.join(', '))
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const courseName = courses.data?.find((course) => course.id === file.courseId)?.name
  const editor = useEditor({
    extensions: editorExtensions,
    content: draft.content as JSONContent,
    immediatelyRender: true,
    editorProps: { attributes: { 'aria-label': t('editor.content'), class: 'min-h-[50vh]' } },
  })
  const save = useMutation({
    mutationFn: () =>
      api.pages.create({
        courseId: file.courseId,
        sourceFileId: file.id,
        title: title.trim(),
        type: 'lecture',
        lectureNumber: null,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        aiVisible: true,
        content: (editor?.getJSON() ?? draft.content) as DocJSON,
      }),
    onSuccess: async (page) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['pages'] }),
        qc.invalidateQueries({ queryKey: ['formulas'] }),
      ])
      await navigate({ to: '/pages/$pageId', params: { pageId: page.id } })
    },
  })

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3.5 md:px-8">
        <button type="button" className={btn('ghost')} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <span className="font-semibold">{t('files.reviewArticle')}</span>
        <span className="ml-auto text-sm text-muted">{courseName}</span>
        <button
          type="button"
          className={btn('primary')}
          disabled={save.isPending || !editor || !title.trim()}
          onClick={() => save.mutate()}
        >
          {save.isPending ? t('common.loading') : t('files.acceptArticle')}
        </button>
      </header>
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-6 py-8">
        <p className="m-0 text-sm text-muted">{t('files.reviewArticleHint', { name: file.name })}</p>
        <input
          aria-label={t('editor.title')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="border-0 bg-transparent p-0 font-serif text-[40px] font-semibold text-ink outline-offset-4"
        />
        <input
          aria-label={t('editor.tags')}
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder={t('editor.tags')}
          className={inputCls}
        />
        <section className="overflow-clip rounded-[14px] border border-line bg-surface">
          {editor && <Toolbar editor={editor} />}
          <div className="px-6 py-8 md:px-12">
            <EditorContent editor={editor} className="prose-nc" />
          </div>
        </section>
        <ErrorNote error={save.error} />
      </div>
    </div>
  )
}

export function Files() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [articleDraft, setArticleDraft] = useState<{ file: FileAsset; draft: ArticleDraft }>()
  const courses = useQuery({ queryKey: ['courses'], queryFn: api.courses.list })
  const editable = courses.data?.filter((c) => c.role !== 'viewer') ?? []
  const [courseId, setCourseId] = useState<string>()
  const target = courseId ?? editable[0]?.id
  const files = useQuery({
    queryKey: ['files', 'all'],
    queryFn: () => api.files.list(),
    refetchInterval: (q) =>
      q.state.data?.some((f) => f.status === 'uploaded' || f.status === 'processing') ? 2000 : false,
  })
  const remove = useMutation({
    mutationFn: api.files.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files'] }),
  })
  const createArticle = useMutation({
    mutationFn: (file: FileAsset) => api.files.articleDraft(file.id),
    onSuccess: (draft, file) => setArticleDraft({ file, draft }),
  })
  const courseName = (id: string) => courses.data?.find((c) => c.id === id)?.name

  if (articleDraft)
    return (
      <ArticleDraftEditor
        file={articleDraft.file}
        draft={articleDraft.draft}
        onCancel={() => setArticleDraft(undefined)}
      />
    )

  return (
    <div className="flex max-w-[1100px] flex-col gap-6 px-6 pb-18 pt-10 md:px-12">
      <h1 className="m-0 text-[40px] font-extrabold tracking-[-0.025em]">{t('files.title')}</h1>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="up-course" className="text-[13px] font-semibold text-muted">
            {t('files.course')}
          </label>
          <select
            id="up-course"
            className={inputCls}
            value={target ?? ''}
            onChange={(e) => setCourseId(e.target.value)}
          >
            {editable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <FileDrop courseId={target} />
      {files.data?.length === 0 && <Empty>{t('files.none')}</Empty>}
      {!!files.data?.length && (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <tbody>
              {files.data.map((f) => (
                <tr key={f.id} className="border-t border-line-soft first:border-0">
                  <td className="w-16 py-3 pl-5">
                    <FileBadge name={f.name} />
                  </td>
                  <td className="py-3 font-medium">
                    <a href={api.files.url(f.id, true)} target="_blank" rel="noreferrer" className="text-ink">
                      {f.name}
                    </a>
                    {f.error && <div className="text-xs text-danger">{f.error}</div>}
                  </td>
                  <td className="py-3 text-muted">{courseName(f.courseId)}</td>
                  <td className="py-3 font-mono text-xs text-muted">{bytes(f.size)}</td>
                  <td
                    className={`py-3 text-xs font-semibold ${f.status === 'indexed' ? 'text-ok' : f.status === 'failed' ? 'text-danger' : 'text-muted'}`}
                  >
                    {t(`files.status.${f.status}`)}
                  </td>
                  <td className="py-3 text-muted">{timeAgo(f.createdAt)}</td>
                  <td className="py-3 pr-3 text-right">
                    {f.status === 'indexed' &&
                      (f.name.toLowerCase().endsWith('.pdf') || f.mime === 'application/pdf') &&
                      editable.some((course) => course.id === f.courseId) && (
                        <button
                          type="button"
                          disabled={createArticle.isPending}
                          onClick={() => createArticle.mutate(f)}
                          className={`${btn('secondary', 'sm')} mr-2`}
                        >
                          {createArticle.isPending && createArticle.variables?.id === f.id ? (
                            <span role="status" className="inline-flex items-center gap-2">
                              <svg
                                aria-hidden="true"
                                className="h-4 w-4 animate-spin"
                                viewBox="0 0 24 24"
                                fill="none"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="9"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M12 3a9 9 0 0 0-9 9h3a6 6 0 0 1 6-6V3Z"
                                />
                              </svg>
                              {t('files.generatingArticle')}
                            </span>
                          ) : (
                            t('files.createArticle')
                          )}
                        </button>
                      )}
                    <button
                      type="button"
                      aria-label={`${t('files.remove')} ${f.name}`}
                      onClick={() => remove.mutate(f.id)}
                      className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-line-soft"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorNote error={createArticle.error} />
    </div>
  )
}
