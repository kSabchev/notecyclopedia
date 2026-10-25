import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Empty, ErrorNote, btn } from '../components/ui'
import { api } from '../lib/api'

const PAGE_SIZE = 50

export function AdminClaudeUsage() {
  const { t, i18n } = useTranslation()
  const calls = useInfiniteQuery({
    queryKey: ['admin', 'claude-calls'],
    queryFn: ({ pageParam }) => api.admin.claudeCalls(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
  })
  const rows = calls.data?.pages.flatMap((page) => page.calls) ?? []
  const knownCosts = rows.flatMap((call) =>
    call.estimatedCostUsd === null ? [] : [Number(call.estimatedCostUsd)],
  )
  const totalCost = knownCosts.reduce((sum, value) => sum + value, 0)
  const number = new Intl.NumberFormat(i18n.language)
  const currency = new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 8,
  })
  const timestamp = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="flex max-w-[1200px] flex-col gap-6 px-6 pb-18 pt-10 md:px-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[36px] font-extrabold tracking-[-0.025em]">{t('adminUsage.title')}</h1>
          <p className="mb-0 mt-2 text-sm text-muted">{t('adminUsage.subtitle')}</p>
        </div>
        <button type="button" className={btn('secondary')} onClick={() => calls.refetch()}>
          {t('common.retry')}
        </button>
      </header>
      <p className="m-0 rounded-[10px] border border-line bg-surface-2 p-4 text-sm text-muted">
        {t('adminUsage.privacyAndCost')}
      </p>
      <ErrorNote error={calls.error} />
      {rows.length === 0 && !calls.isPending && <Empty>{t('adminUsage.empty')}</Empty>}
      {calls.isPending && <p className="m-0 text-muted">{t('common.loading')}</p>}
      {rows.length > 0 && (
        <p className="m-0 text-sm text-muted">
          {t('adminUsage.loadedSummary', {
            count: rows.length,
            cost: currency.format(totalCost),
            priced: knownCosts.length,
          })}
        </p>
      )}
      <div className="flex flex-col gap-4">
        {rows.map((call) => (
          <article
            key={call.id}
            className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-5"
          >
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <strong className="text-base">
                {t(`adminUsage.operations.${call.operation}`, call.operation)}
              </strong>
              <span className="text-sm text-muted">{call.model}</span>
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-semibold ${call.status === 'succeeded' ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger'}`}
              >
                {t(`adminUsage.status.${call.status}`)}
              </span>
              <time className="ml-auto text-sm text-muted" dateTime={call.createdAt}>
                {timestamp.format(new Date(call.createdAt))}
              </time>
            </header>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <span>
                {t('adminUsage.user')}: {call.userEmail ?? t('adminUsage.deletedUser')}
              </span>
              <span>
                {t('adminUsage.input')}: {call.inputTokens === null ? '—' : number.format(call.inputTokens)}
              </span>
              <span>
                {t('adminUsage.output')}:{' '}
                {call.outputTokens === null ? '—' : number.format(call.outputTokens)}
              </span>
              <span>
                {t('adminUsage.cacheRead')}:{' '}
                {call.cacheReadTokens === null ? '—' : number.format(call.cacheReadTokens)}
              </span>
              <span>
                {t('adminUsage.cacheWrite')}:{' '}
                {call.cacheWriteTokens === null ? '—' : number.format(call.cacheWriteTokens)}
              </span>
              <span>
                {t('adminUsage.estimatedCost')}:{' '}
                {call.estimatedCostUsd === null
                  ? t('adminUsage.unavailable')
                  : currency.format(Number(call.estimatedCostUsd))}
              </span>
            </div>
            {call.error && (
              <p className="m-0 rounded-md bg-danger-soft p-3 text-sm text-danger">{call.error}</p>
            )}
            <details>
              <summary className="cursor-pointer text-sm font-semibold">{t('adminUsage.viewPrompt')}</summary>
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-surface-2 p-4 text-xs">
                {JSON.stringify(call.request, null, 2)}
              </pre>
            </details>
          </article>
        ))}
      </div>
      {calls.hasNextPage && (
        <button
          type="button"
          className={btn('secondary')}
          disabled={calls.isFetchingNextPage}
          onClick={() => calls.fetchNextPage()}
        >
          {calls.isFetchingNextPage ? t('common.loading') : t('adminUsage.loadMore')}
        </button>
      )}
    </div>
  )
}
