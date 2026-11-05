import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui'

/** The frame around a widget block in a page: its title, the editor's buttons, a status line and the body. */
export function WidgetFrame({
  title,
  editable,
  actions,
  onDelete,
  status,
  children,
}: {
  title: string
  editable: boolean
  /** More editor buttons, before Remove. */
  actions?: ReactNode
  onDelete: () => void
  status?: { ok: boolean; text: string } | null
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface font-sans">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-surface-2 px-5 py-3">
        <span className="min-w-0 flex-1 font-semibold">{title}</span>
        {editable && (
          <>
            {actions}
            <Button size="sm" variant="danger" onClick={onDelete}>
              {t('widget.remove')}
            </Button>
          </>
        )}
      </div>
      {status && (
        <p role="status" className={`m-0 px-5 pt-3 text-sm ${status.ok ? 'text-ok' : 'text-danger'}`}>
          {status.text}
        </p>
      )}
      {children}
    </div>
  )
}
