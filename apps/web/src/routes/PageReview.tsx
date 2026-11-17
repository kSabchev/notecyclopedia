import { type DocBlock, type DocJSON, INTRO_SECTION, docSections, reviewFits } from '@nc/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { EditorContent, type JSONContent, useEditor } from '@tiptap/react'
import type { TFunction } from 'i18next'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DocView } from '../components/DocView'
import { EditorToolbar } from '../components/EditorToolbar'
import { useConfirm } from '../components/FeedbackProvider'
import { editorExtensions } from '../components/extensions'
import { SkeletonPage, Spinner, usePageTitle } from '../components/feedback'
import { ErrorNote, btn } from '../components/ui'
import { api } from '../lib/api'

type ReviewResult = Awaited<ReturnType<typeof api.ai.reviewPage>>

export function PageReview() {
  const { t } = useTranslation()
  usePageTitle(t('page.reviewTitle'))
  const { pageId } = useParams({ from: '/app/pages/$pageId/review' })
  const page = useQuery({ queryKey: ['page', pageId], queryFn: () => api.pages.get(pageId) })
  const review = useMutation({ mutationFn: (section?: string) => api.ai.reviewPage(pageId, section) })
  const parts = useMemo(() => (page.data ? reviewParts(page.data.content, t) : []), [page.data, t])
  const [choice, setChoice] = useState<string | null>(null)
  const chosen = parts.find((p) => p.id === choice) ?? parts.find((p) => p.fits) ?? parts[0]
  const started = useRef(false)

  // A page without headings has only one part: review it at once, as before.
  useEffect(() => {
    if (started.current || parts.length !== 1) return
    started.current = true
    review.mutate(undefined)
  }, [parts, review])

  if (page.isPending) return <SkeletonPage />
  if (page.error)
    return (
      <div className="mx-auto w-full max-w-[1000px] px-6 py-10">
        <ErrorNote error={page.error} />
      </div>
    )
  if (review.isPending)
    return (
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-4 px-6 py-10">
        <p role="status" className="m-0 flex items-center gap-2.5 text-muted">
          <Spinner />
          {review.variables
            ? t('page.reviewPreparingSection', { section: chosen?.label })
            : t('page.reviewPreparing')}
        </p>
      </div>
    )
  if (review.isSuccess) return <ReviewDraft result={review.data} />

  const back = (
    <Link to="/pages/$pageId" params={{ pageId }} className={btn('secondary', 'sm')}>
      {t('page.reviewBack')}
    </Link>
  )
  if (review.isError && parts.length <= 1)
    return (
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 px-6 py-10">
        <ErrorNote error={review.error} />
        <div>{back}</div>
      </div>
    )

  // Choose the whole page or one section; after an error (such as a part too long), choose again.
  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-3xl font-semibold">{t('page.reviewChoose')}</h1>
        <p className="m-0 text-sm text-muted">{t('page.reviewChooseHint')}</p>
      </header>
      <ErrorNote error={review.error} />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (chosen) review.mutate(chosen.id === WHOLE ? undefined : chosen.id)
        }}
      >
        <fieldset className="m-0 flex flex-col gap-1 rounded-[12px] border border-line bg-surface p-3">
          <legend className="sr-only">{t('page.reviewChoose')}</legend>
          {parts.map((part) => (
            <label
              key={part.id}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[8px] px-3 hover:bg-surface-2 ${part.level === 3 ? 'pl-9' : ''}`}
            >
              <input
                type="radio"
                name="review-part"
                className="h-[18px] w-[18px] accent-accent"
                checked={chosen?.id === part.id}
                onChange={() => setChoice(part.id)}
              />
              <span className={`flex-1 ${part.id === WHOLE ? 'font-semibold' : ''}`}>{part.label}</span>
              {!part.fits && <span className="text-xs text-muted">{t('page.reviewTooLong')}</span>}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={btn('ai')} disabled={!chosen}>
            {review.isError ? t('page.reviewOther') : t('page.reviewStart')}
          </button>
          {back}
        </div>
      </form>
    </main>
  )
}

/** The whole page in the review choices. */
const WHOLE = 'page'

/** What can be reviewed: the whole page, then each section, each marked if it is probably too long for one review. */
function reviewParts(content: DocJSON, t: TFunction) {
  const blocks = (content.content ?? []) as DocBlock[]
  return [
    { id: WHOLE, label: t('page.reviewWhole'), level: 0, fits: reviewFits(blocks) },
    ...docSections(content).map((s) => ({
      id: s.id,
      label: s.id === INTRO_SECTION ? t('page.reviewIntro') : s.title || t('common.untitled'),
      level: s.level,
      fits: reviewFits(blocks.slice(s.start, s.end)),
    })),
  ]
}

/** The proposed version opens in an editor, so the user can adjust the AI draft before accepting it. */
function ReviewDraft({ result }: { result: ReviewResult }) {
  const { t } = useTranslation()
  const confirm = useConfirm()
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
          <p className="m-0 text-sm text-muted">
            {draft.section
              ? t('page.reviewReadySection', {
                  title: page.title,
                  section: draft.section.title || t('page.reviewIntro'),
                })
              : t('page.reviewReady', { title: page.title })}
          </p>
        </div>
        <Link
          to="/pages/$pageId"
          params={{ pageId: page.id }}
          className={btn('secondary', 'sm')}
          onClick={async (e) => {
            if (!edited) return
            e.preventDefault()
            if (await confirm({ title: t('page.reviewLeave'), danger: true }))
              navigate({ to: '/pages/$pageId', params: { pageId: page.id } })
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
          {accept.isPending && <Spinner />}
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
            {editor && <EditorToolbar editor={editor} courseId={page.courseId} pageId={page.id} />}
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
