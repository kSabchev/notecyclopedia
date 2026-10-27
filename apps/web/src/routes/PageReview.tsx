import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DocView } from '../components/DocView'
import { ErrorNote, btn } from '../components/ui'
import { api } from '../lib/api'

export function PageReview() {
  const { t } = useTranslation()
  const { pageId } = useParams({ from: '/app/pages/$pageId/review' })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const review = useMutation({ mutationFn: () => api.ai.reviewPage(pageId) })
  const generate = review.mutate
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    generate()
  }, [generate])

  const accept = useMutation({
    mutationFn: () => {
      if (!review.data) throw new Error(t('page.reviewNotReady'))
      const { page, review: draft } = review.data
      return api.pages.update(page.id, {
        title: page.title,
        type: page.type,
        lectureNumber: page.lectureNumber,
        tags: page.tags,
        aiVisible: page.aiVisible,
        content: draft.content,
        baseRevision: page.revision,
        message: t('page.aiReviewRevisionMessage'),
      })
    },
    onSuccess: async (page) => {
      qc.setQueryData(['page', page.id], page)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['pages'] }),
        qc.invalidateQueries({ queryKey: ['formulas'] }),
      ])
      await navigate({ to: '/pages/$pageId', params: { pageId: page.id } })
    },
  })

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

  const { page, review: draft } = review.data
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-8 md:px-10">
      <header className="flex flex-wrap items-center gap-3 border-b border-line pb-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="m-0 font-serif text-3xl font-semibold">{t('page.reviewTitle')}</h1>
          <p className="m-0 text-sm text-muted">{t('page.reviewReady', { title: page.title })}</p>
        </div>
        <Link to="/pages/$pageId" params={{ pageId }} className={btn('secondary', 'sm')}>
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
        <section className="min-w-0 rounded-[12px] border-2 border-ai bg-surface p-5">
          <h2 className="m-0 mb-4 text-lg font-bold text-ai-text">{t('page.reviewProposed')}</h2>
          <DocView doc={draft.content} />
        </section>
      </div>
      <ErrorNote error={accept.error} />
    </main>
  )
}
