import type { DailyExpansionKind, DailyQuestion } from '@nc/shared'
import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import { Markdown } from './Markdown'
import { ErrorNote, btn, inputCls } from './ui'

/**
 * A daily question with its answer hidden until asked for. Every extra (a story, a harder question, checking
 * your answer, your own question) happens only on request; answering is never required.
 */
export function DailyQuestionView({ question: q }: { question: DailyQuestion }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [showAnswer, setShowAnswer] = useState(false)
  const [checking, setChecking] = useState(false)
  const [mine, setMine] = useState('')
  const update = (next: DailyQuestion) => {
    qc.setQueryData(['daily', 'today'], (old: { day: string; question: DailyQuestion | null } | undefined) =>
      old?.question?.id === next.id ? { ...old, question: next } : old,
    )
    qc.setQueriesData({ queryKey: ['daily', 'list'] }, (old: InfiniteData<DailyQuestion[]> | undefined) =>
      old ? { ...old, pages: old.pages.map((page) => page.map((x) => (x.id === next.id ? next : x))) } : old,
    )
  }
  const expand = useMutation({
    mutationFn: (kind: DailyExpansionKind) => api.daily.expand(q.id, kind),
    onSuccess: update,
  })
  const save = useMutation({
    mutationFn: () =>
      api.daily.save(q.id, {
        question: t('daily.question'),
        answer: t('daily.answer'),
        story: t('daily.story'),
        advanced: t('daily.advanced'),
      }),
    onSuccess: () => q.pageId && qc.invalidateQueries({ queryKey: ['page', q.pageId] }),
  })
  const cost = q.usage?.costUsd

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        {q.pageId ? (
          <Link
            to="/pages/$pageId"
            params={{ pageId: q.pageId }}
            hash={q.nodeId ?? undefined}
            className="font-semibold"
          >
            {q.topic}
          </Link>
        ) : (
          <span className="font-semibold">{q.topic}</span>
        )}
        {q.topic !== q.pageTitle && <span>· {q.pageTitle}</span>}
      </div>
      <div className="text-[17px]">
        <Markdown text={q.question} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn('secondary', 'sm')} onClick={() => setShowAnswer((s) => !s)}>
          {showAnswer ? t('daily.hideAnswer') : t('daily.showAnswer')}
        </button>
        <button type="button" className={btn('secondary', 'sm')} onClick={() => setChecking((s) => !s)}>
          {t('daily.checkMine')}
        </button>
      </div>

      {checking && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!mine.trim()) return
            // The AI portal's "Check my working" mode, with the question's page as the source.
            navigate({
              to: '/ai',
              search: {
                mode: 'check',
                q: `${t('daily.question')}: ${q.question}\n\n${t('daily.myAnswer')}: ${mine.trim()}`,
                pageId: q.pageId ?? undefined,
              },
            })
          }}
        >
          <label htmlFor={`mine-${q.id}`} className="text-[13px] font-semibold text-muted">
            {t('daily.myAnswer')}
          </label>
          <textarea
            id={`mine-${q.id}`}
            rows={3}
            className={inputCls}
            value={mine}
            onChange={(e) => setMine(e.target.value)}
          />
          <button type="submit" className={`${btn('ai', 'sm')} self-start`} disabled={!mine.trim()}>
            {t('daily.check')}
          </button>
        </form>
      )}

      {showAnswer && (
        <section
          aria-label={t('daily.answer')}
          className="flex flex-col gap-2 rounded-[12px] bg-surface-2 px-4 py-3"
        >
          <Markdown text={q.answer} />
          {q.beyondNotes && (
            <p className="m-0 text-sm text-muted">
              <strong>{t('daily.beyondNotes')}</strong> {q.beyondNotes}
            </p>
          )}
        </section>
      )}

      {q.expansions.story && (
        <section aria-label={t('daily.story')} className="flex flex-col gap-1 border-l-4 border-ai pl-4">
          <h3 className="m-0 text-sm font-bold">{t('daily.story')}</h3>
          <Markdown text={q.expansions.story} />
        </section>
      )}
      {q.expansions.advanced && (
        <section
          aria-label={t('daily.advanced')}
          className="flex flex-col gap-1 border-l-4 border-accent pl-4"
        >
          <h3 className="m-0 text-sm font-bold">{t('daily.advanced')}</h3>
          <Markdown text={q.expansions.advanced.question} />
          <details>
            <summary className="cursor-pointer text-sm font-semibold">{t('daily.showAnswer')}</summary>
            <Markdown text={q.expansions.advanced.answer} />
          </details>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
          {t('daily.expand')}
        </span>
        {!q.expansions.story && (
          <button
            type="button"
            className={btn('secondary', 'sm')}
            disabled={expand.isPending}
            onClick={() => expand.mutate('story')}
          >
            {expand.isPending && expand.variables === 'story' ? t('common.loading') : t('daily.tellStory')}
          </button>
        )}
        {!q.expansions.advanced && (
          <button
            type="button"
            className={btn('secondary', 'sm')}
            disabled={expand.isPending}
            onClick={() => expand.mutate('advanced')}
          >
            {expand.isPending && expand.variables === 'advanced' ? t('common.loading') : t('daily.harder')}
          </button>
        )}
        <Link
          to="/ai"
          search={{ mode: 'tutor', prefill: t('daily.ownPrefill', { question: q.question }) }}
          className={btn('secondary', 'sm')}
        >
          {t('daily.ownQuestion')}
        </Link>
        <span className="flex-1" />
        {q.pageId &&
          (save.isSuccess ? (
            <Link to="/pages/$pageId" params={{ pageId: q.pageId }} className="text-sm font-semibold">
              {t('daily.savedToPage')} →
            </Link>
          ) : (
            <button
              type="button"
              className={btn('secondary', 'sm')}
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {t('daily.saveToPage')}
            </button>
          ))}
      </div>
      {cost != null && <p className="m-0 text-xs text-muted">{t('daily.cost', { cost: cost.toFixed(4) })}</p>}
      <ErrorNote error={expand.error ?? save.error} />
    </div>
  )
}
