import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { btn } from './ui'

/** A short message after an action ("Saved", "Link removed"), optionally with Undo. */
type Toast = { id: number; message: string; undo?: () => void }
type ToastFn = (message: string, opts?: { undo?: () => void }) => void

/** A question before an action that cannot be undone. Resolves true when confirmed. */
type ConfirmOptions = { title: string; body?: string; confirmLabel?: string; danger?: boolean }
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ToastContext = createContext<ToastFn>(() => {})
const ConfirmContext = createContext<ConfirmFn>(async () => false)

export const useToast = () => useContext(ToastContext)
export const useConfirm = () => useContext(ConfirmContext)

/** How long a message stays: longer when it can be undone. */
const TOAST_MS = 4000
const UNDO_MS = 8000

/** Messages and confirmations for everything inside it; mounted once in the layout. */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), [])
  const toast = useCallback<ToastFn>(
    (message, opts) => {
      const id = nextId.current++
      setToasts((all) => [...all.slice(-2), { id, message, undo: opts?.undo }])
      setTimeout(() => dismiss(id), opts?.undo ? UNDO_MS : TOAST_MS)
    },
    [dismiss],
  )

  const [question, setQuestion] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise((resolve) => setQuestion({ ...opts, resolve })),
    [],
  )
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (question && !dialog.current?.open) dialog.current?.showModal()
  }, [question])
  const answer = (ok: boolean) => {
    question?.resolve(ok)
    setQuestion(null)
    dialog.current?.close()
  }

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2"
        >
          {toasts.map((x) => (
            <div
              key={x.id}
              className="pointer-events-auto flex items-center gap-3 rounded-[12px] bg-inverse px-4 py-3 text-sm text-inverse-ink shadow-lg"
            >
              <span className="flex-1">{x.message}</span>
              {x.undo && (
                <button
                  type="button"
                  className="cursor-pointer font-semibold text-ai-on-dark"
                  onClick={() => {
                    x.undo?.()
                    dismiss(x.id)
                  }}
                >
                  {t('common.undo')}
                </button>
              )}
              <button
                type="button"
                aria-label={t('common.close')}
                className="cursor-pointer text-inverse-ink/70"
                onClick={() => dismiss(x.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <dialog
          ref={dialog}
          aria-labelledby="confirm-title"
          onCancel={(e) => {
            e.preventDefault()
            answer(false)
          }}
          className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[14px] border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
        >
          {question && (
            <form
              method="dialog"
              className="flex flex-col gap-4 p-6"
              onSubmit={(e) => {
                e.preventDefault()
                answer(true)
              }}
            >
              <h2 id="confirm-title" className="m-0 text-lg font-bold">
                {question.title}
              </h2>
              {question.body && <p className="m-0 text-[15px] text-ink-2">{question.body}</p>}
              <div className="flex justify-end gap-2">
                {/* A destructive action starts on Cancel, so Enter does not confirm it by accident. */}
                <button
                  type="button"
                  autoFocus={question.danger}
                  className={btn('secondary')}
                  onClick={() => answer(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  autoFocus={!question.danger}
                  className={btn(question.danger ? 'danger' : 'primary')}
                >
                  {question.confirmLabel ?? t('common.ok')}
                </button>
              </div>
            </form>
          )}
        </dialog>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  )
}
