import type { DocJSON } from '@nc/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { EditorContent, type JSONContent, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DocView } from '../components/DocView'
import { EditorToolbar } from '../components/EditorToolbar'
import { editorExtensions } from '../components/extensions'
import { ErrorNote, btn } from '../components/ui'
import { api } from '../lib/api'

type ReviewResult = Awaited<ReturnType<typeof api.ai.reviewPage>>

export function PageReview() {
  const { t } = useTranslation()
  const { pageId } = useParams({ from: '/app/pages/$pageId/review' })
  const review = useMutation({ mutationFn: () => api.ai.reviewPage(pageId) })
  const generate = review.mutate
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    generate()
  }, [generate])

  if (review.isIdle || review.isPending)
    return (
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-4 px-6 py-10">
        <p className="m-0 text-muted">{t('page.reviewPreparing')}</p>
      </div>
    )
  if (review.isError)
    return (
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 px-6 py-10">
        <ErrorNote error={review.error} />
        <Link to="/pages/$pageId" params={{ pageId }} className={btn('secondary', 'sm')}>
          {t('page.reviewBack')}
        </Link>
      </div>
    )

  return <ReviewDraft result={review.data} />
}

/** The proposed version opens in an editor, so the user can adjust the AI draft before accepting it. */
function ReviewDraft({ result }: { result: ReviewResult }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { page, review: draft } = result
  const [edited, setEdited] = useState(false)
  const editor = useEditor({
    extensions: editorExtensions,
    content: draft.content as JSONContent,
    immediatelyRender: true,
    editorProps: { attributes: { 'aria-label': t('page.reviewProposed'), class: 'min-h-[30vh]' } },
    onUpdate: () => setEdited(true),
  })

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (edited) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [edited])

  const accept = useMutation({
    mutationFn: () =>
      api.pages.update(page.id, {
        title: page.title,
        type: page.type,
        lectureNumber: page.lectureNumber,
        tags: page.tags,
        aiVisible: page.aiVisible,
        content: (editor?.getJSON() ?? draft.content) as DocJSON,
        baseRevision: page.revision,
        message: t('page.aiReviewRevisionMessage'),
      }),
    onSuccess: async (saved) => {
      setEdited(false)
      qc.setQueryData(['page', saved.id], saved)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['pages'] }),
        qc.invalidateQueries({ queryKey: ['formulas'] }),
      ])
      await navigate({ to: '/pages/$pageId', params: { pageId: saved.id } })
    },
  })

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-8 md:px-10">
      <header className="flex flex-wrap items-center gap-3 border-b border-line pb-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="m-0 font-serif text-3xl font-semibold">{t('page.reviewTitle')}</h1>
          <p className="m-0 text-sm text-muted">{t('page.reviewReady', { title: page.title })}</p>
        </div>
        <Link
          to="/pages/$pageId"
          params={{ pageId: page.id }}
          className={btn('secondary', 'sm')}
          onClick={(e) => {
            if (edited && !window.confirm(t('page.reviewLeave'))) e.preventDefault()
          }}
        >
          {t('page.reviewDiscard')}
        </Link>
        <button
          type="button"
          className={btn('primary', 'sm')}
          disabled={accept.isPending}
          onClick={() => accept.mutate()}
        >
          {accept.isPending ? t('page.reviewSaving') : t('page.reviewAccept')}
        </button>
      </header>

      <p className="m-0 rounded-[10px] bg-ai-soft px-4 py-3 text-sm text-ai-text">
        {t('page.reviewNotSaved')}
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-bold">{t('page.reviewFindings')}</h2>
        {draft.findings.length > 0 ? (
          <ul className="m-0 flex list-disc flex-col gap-2 rounded-[12px] border border-line bg-surface p-5 pl-10">
            {draft.findings.map((finding, index) => (
              <li key={`${index}-${finding}`}>{finding}</li>
            ))}
          </ul>
        ) : (
          <p className="m-0 rounded-[12px] border border-line bg-surface p-5 text-sm text-muted">
            {t('page.reviewNoFindings')}
          </p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="min-w-0 rounded-[12px] border border-line bg-surface p-5">
          <h2 className="m-0 mb-4 text-lg font-bold">{t('page.reviewOriginal')}</h2>
          <DocView doc={page.content} />
        </section>
        <section className="min-w-0 overflow-clip rounded-[12px] border-2 border-ai bg-surface">
          <div className="flex flex-wrap items-center gap-3 px-5 pt-5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 className="m-0 text-lg font-bold text-ai-text">
                {t('page.reviewProposed')}
                {edited && (
                  <span className="ml-2 rounded-md bg-ai-soft px-2 py-0.5 align-middle text-xs font-semibold">
                    {t('page.reviewEdited')}
                  </span>
                )}
              </h2>
              <p className="m-0 text-sm text-muted">{t('page.reviewEditable')}</p>
            </div>
            {edited && (
              <button
                type="button"
                className={btn('ghost', 'sm')}
                onClick={() => {
                  editor?.commands.setContent(draft.content as JSONContent)
                  setEdited(false)
                }}
              >
                {t('page.reviewReset')}
              </button>
            )}
          </div>
          <div className="mt-4">
            {editor && <EditorToolbar editor={editor} />}
            <div className="px-5 pb-5 pt-4">
              <EditorContent editor={editor} className="prose-nc" />
            </div>
          </div>
        </section>
      </div>
      <ErrorNote error={accept.error} />
    </main>
  )
}
