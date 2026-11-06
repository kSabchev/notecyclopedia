import { type RefObject, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type HelpKind = 'explain' | 'why' | 'example'
export const KINDS: HelpKind[] = ['explain', 'why', 'example']

/** What the reader asked about: selected text, or a formula block. */
export type HelpTarget =
  | { type: 'text'; text: string }
  | { type: 'formula'; nodeId: string | null; latex: string; label: string | null }

/** Longest selection sent as a question (characters); the page itself is the context. */
const MAX_SELECTION = 2000

/**
 * A small toolbar over text selected in `container`: Explain / Why does this hold? / Show an example. The selection
 * stays as it is (buttons do not take focus on mouse down).
 */
export function SelectionHelp({
  container,
  onAsk,
}: {
  container: RefObject<HTMLElement | null>
  onAsk: (target: HelpTarget, kind: HelpKind) => void
}) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null)
  useEffect(() => {
    const update = () => {
      const s = window.getSelection()
      const root = container.current
      const text = s?.toString().trim() ?? ''
      if (!s || s.isCollapsed || !root || text.length < 3 || !root.contains(s.anchorNode))
        return setSelection(null)
      const rect = s.getRangeAt(0).getBoundingClientRect()
      setSelection({ text: text.slice(0, MAX_SELECTION), top: rect.top, left: rect.left + rect.width / 2 })
    }
    document.addEventListener('selectionchange', update)
    window.addEventListener('scroll', update, true)
    return () => {
      document.removeEventListener('selectionchange', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [container])
  if (!selection) return null
  return (
    <div
      role="toolbar"
      aria-label={t('help.toolbar')}
      className="fixed z-40 flex -translate-x-1/2 -translate-y-full gap-1 rounded-[10px] bg-inverse p-1 shadow-lg"
      style={{ top: Math.max(selection.top - 8, 48), left: selection.left }}
    >
      {KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onAsk({ type: 'text', text: selection.text }, kind)
            window.getSelection()?.removeAllRanges()
          }}
          className="min-h-9 cursor-pointer rounded-[8px] border-0 bg-transparent px-3 text-sm font-semibold text-inverse-ink hover:bg-inverse-2"
        >
          {t(`help.kind.${kind}`)}
        </button>
      ))}
    </div>
  )
}
