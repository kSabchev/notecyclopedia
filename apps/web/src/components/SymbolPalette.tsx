import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon, PenIcon, SigmaIcon, TrashIcon } from './Icons'
import { btn, inputCls } from './ui'

type SymbolGroup = 'greek' | 'operators' | 'relations' | 'custom'

interface MathSymbol {
  id: string
  group: SymbolGroup
  label: string
  display: string
  source: string
}

const STORAGE_KEY = 'nc.math-symbols'

const DEFAULT_SYMBOLS: MathSymbol[] = [
  { id: 'alpha', group: 'greek', label: 'alpha', display: 'α', source: '\\alpha' },
  { id: 'beta', group: 'greek', label: 'beta', display: 'β', source: '\\beta' },
  { id: 'chi', group: 'greek', label: 'chi', display: 'χ', source: '\\chi' },
  { id: 'gamma', group: 'greek', label: 'gamma', display: 'γ', source: '\\gamma' },
  { id: 'delta', group: 'greek', label: 'delta', display: 'δ', source: '\\delta' },
  { id: 'epsilon', group: 'greek', label: 'epsilon', display: 'ε', source: '\\epsilon' },
  { id: 'eta', group: 'greek', label: 'eta', display: 'η', source: '\\eta' },
  { id: 'iota', group: 'greek', label: 'iota', display: 'ι', source: '\\iota' },
  { id: 'kappa', group: 'greek', label: 'kappa', display: 'κ', source: '\\kappa' },
  { id: 'theta', group: 'greek', label: 'theta', display: 'θ', source: '\\theta' },
  { id: 'lambda', group: 'greek', label: 'lambda', display: 'λ', source: '\\lambda' },
  { id: 'mu', group: 'greek', label: 'mu', display: 'μ', source: '\\mu' },
  { id: 'nu', group: 'greek', label: 'nu', display: 'ν', source: '\\nu' },
  { id: 'xi', group: 'greek', label: 'xi', display: 'ξ', source: '\\xi' },
  { id: 'omicron', group: 'greek', label: 'omicron', display: 'ο', source: 'o' },
  { id: 'pi', group: 'greek', label: 'pi', display: 'π', source: '\\pi' },
  { id: 'psi', group: 'greek', label: 'psi', display: 'ψ', source: '\\psi' },
  { id: 'rho', group: 'greek', label: 'rho', display: 'ρ', source: '\\rho' },
  { id: 'sigma', group: 'greek', label: 'sigma', display: 'σ', source: '\\sigma' },
  { id: 'tau', group: 'greek', label: 'tau', display: 'τ', source: '\\tau' },
  { id: 'phi', group: 'greek', label: 'phi', display: 'φ', source: '\\phi' },
  { id: 'upsilon', group: 'greek', label: 'upsilon', display: 'υ', source: '\\upsilon' },
  { id: 'omega', group: 'greek', label: 'omega', display: 'ω', source: '\\omega' },
  { id: 'zeta', group: 'greek', label: 'zeta', display: 'ζ', source: '\\zeta' },
  { id: 'Gamma', group: 'greek', label: 'Gamma', display: 'Γ', source: '\\Gamma' },
  { id: 'Delta', group: 'greek', label: 'Delta', display: 'Δ', source: '\\Delta' },
  { id: 'Theta', group: 'greek', label: 'Theta', display: 'Θ', source: '\\Theta' },
  { id: 'Lambda', group: 'greek', label: 'Lambda', display: 'Λ', source: '\\Lambda' },
  { id: 'Xi', group: 'greek', label: 'Xi', display: 'Ξ', source: '\\Xi' },
  { id: 'Pi', group: 'greek', label: 'Pi', display: 'Π', source: '\\Pi' },
  { id: 'Sigma', group: 'greek', label: 'Sigma', display: 'Σ', source: '\\Sigma' },
  { id: 'Upsilon', group: 'greek', label: 'Upsilon', display: 'Υ', source: '\\Upsilon' },
  { id: 'Phi', group: 'greek', label: 'Phi', display: 'Φ', source: '\\Phi' },
  { id: 'Psi', group: 'greek', label: 'Psi', display: 'Ψ', source: '\\Psi' },
  { id: 'Omega', group: 'greek', label: 'Omega', display: 'Ω', source: '\\Omega' },
  { id: 'plus-minus', group: 'operators', label: 'plus or minus', display: '±', source: '\\pm' },
  { id: 'times', group: 'operators', label: 'times', display: '×', source: '\\times' },
  { id: 'divide', group: 'operators', label: 'divide', display: '÷', source: '\\div' },
  { id: 'dot', group: 'operators', label: 'dot product', display: '·', source: '\\cdot' },
  { id: 'sqrt', group: 'operators', label: 'square root', display: '√', source: '\\sqrt{}' },
  { id: 'sum', group: 'operators', label: 'sum', display: '∑', source: '\\sum' },
  { id: 'product', group: 'operators', label: 'product', display: '∏', source: '\\prod' },
  { id: 'integral', group: 'operators', label: 'integral', display: '∫', source: '\\int' },
  { id: 'partial', group: 'operators', label: 'partial derivative', display: '∂', source: '\\partial' },
  { id: 'nabla', group: 'operators', label: 'nabla', display: '∇', source: '\\nabla' },
  { id: 'infinity', group: 'operators', label: 'infinity', display: '∞', source: '\\infty' },
  { id: 'degree', group: 'operators', label: 'degree', display: '°', source: '^\\circ' },
  { id: 'approx', group: 'relations', label: 'approximately equal', display: '≈', source: '\\approx' },
  { id: 'not-equal', group: 'relations', label: 'not equal', display: '≠', source: '\\ne' },
  { id: 'less-equal', group: 'relations', label: 'less than or equal', display: '≤', source: '\\leq' },
  { id: 'greater-equal', group: 'relations', label: 'greater than or equal', display: '≥', source: '\\geq' },
  { id: 'proportional', group: 'relations', label: 'proportional to', display: '∝', source: '\\propto' },
  { id: 'belongs', group: 'relations', label: 'belongs to', display: '∈', source: '\\in' },
  { id: 'not-belongs', group: 'relations', label: 'does not belong to', display: '∉', source: '\\notin' },
  { id: 'subset', group: 'relations', label: 'subset', display: '⊂', source: '\\subset' },
  { id: 'union', group: 'relations', label: 'union', display: '∪', source: '\\cup' },
  { id: 'intersection', group: 'relations', label: 'intersection', display: '∩', source: '\\cap' },
  { id: 'right-arrow', group: 'relations', label: 'right arrow', display: '→', source: '\\to' },
  { id: 'iff', group: 'relations', label: 'if and only if', display: '↔', source: '\\leftrightarrow' },
]

const isMathSymbol = (value: unknown): value is MathSymbol => {
  if (!value || typeof value !== 'object') return false
  const symbol = value as Record<string, unknown>
  return (
    typeof symbol.id === 'string' &&
    ['greek', 'operators', 'relations', 'custom'].includes(symbol.group as string) &&
    typeof symbol.label === 'string' &&
    typeof symbol.display === 'string' &&
    typeof symbol.source === 'string'
  )
}

function loadSymbols(): { symbols: MathSymbol[]; error: string | null } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return { symbols: DEFAULT_SYMBOLS, error: null }
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed) || !parsed.every(isMathSymbol)) {
      return { symbols: DEFAULT_SYMBOLS, error: 'invalid' }
    }
    return { symbols: parsed, error: null }
  } catch {
    return { symbols: DEFAULT_SYMBOLS, error: 'unavailable' }
  }
}

export function SymbolPalette() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [state, setState] = useState(loadSymbols)
  const [storageError, setStorageError] = useState<string | null>(state.error)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [display, setDisplay] = useState('')
  const [source, setSource] = useState('')
  const didMount = useRef(false)

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true
      return
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.symbols))
      setStorageError(null)
    } catch {
      setStorageError('unavailable')
    }
  }, [state.symbols])

  const copySymbol = async (symbol: MathSymbol) => {
    try {
      await navigator.clipboard.writeText(symbol.source)
      setCopyMessage(t('symbols.copied', { value: symbol.source }))
    } catch {
      setCopyMessage(t('symbols.copyFailed'))
    }
  }

  const addSymbol = (event: FormEvent) => {
    event.preventDefault()
    const trimmedLabel = label.trim()
    const trimmedDisplay = display.trim()
    const trimmedSource = source.trim()
    if (!trimmedLabel || !trimmedDisplay || !trimmedSource) return
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
    setState((current) => ({
      ...current,
      symbols: [
        ...current.symbols,
        { id, group: 'custom', label: trimmedLabel, display: trimmedDisplay, source: trimmedSource },
      ],
    }))
    setLabel('')
    setDisplay('')
    setSource('')
  }

  const removeSymbol = (id: string) => {
    setState((current) => ({
      ...current,
      symbols: current.symbols.filter((symbol) => symbol.id !== id),
    }))
  }

  const resetSymbols = () => {
    if (!window.confirm(t('symbols.confirmReset'))) return
    setState({ symbols: DEFAULT_SYMBOLS, error: null })
    setStorageError(null)
    setLabel('')
    setDisplay('')
    setSource('')
  }

  const groups: SymbolGroup[] = ['greek', 'operators', 'relations', 'custom']

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="math-symbol-palette"
        onClick={() => setOpen((current) => !current)}
        className="fixed bottom-5 right-5 z-40 flex min-h-12 cursor-pointer items-center gap-2 rounded-full bg-ink px-4 font-semibold text-white shadow-lg hover:bg-ink-2"
      >
        <SigmaIcon size={20} />
        {t('symbols.open')}
      </button>

      {open && (
        <aside
          id="math-symbol-palette"
          aria-label={t('symbols.title')}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-line bg-surface shadow-2xl"
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="m-0 text-lg font-bold">{t('symbols.title')}</h2>
              <p className="mb-0 mt-1 text-sm text-muted">{t('symbols.subtitle')}</p>
            </div>
            <button
              type="button"
              aria-label={t('symbols.close')}
              onClick={() => setOpen(false)}
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-bg"
            >
              <CloseIcon />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <p className="mb-4 mt-0 text-xs text-muted">{t('symbols.copyHint')}</p>
            {storageError && (
              <p
                role="alert"
                className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger"
              >
                {t(storageError === 'invalid' ? 'symbols.invalidStorage' : 'symbols.storageFailed')}
              </p>
            )}
            {groups.map((group) => {
              const items = state.symbols.filter((symbol) => symbol.group === group)
              if (items.length === 0) return null
              return (
                <section key={group} aria-labelledby={`symbols-${group}`} className="mb-5">
                  <h3
                    id={`symbols-${group}`}
                    className="mb-2 mt-0 text-xs font-semibold uppercase tracking-[0.06em] text-muted"
                  >
                    {t(`symbols.groups.${group}`)}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {items.map((symbol) => (
                      <div
                        key={symbol.id}
                        className="flex min-w-0 items-stretch overflow-hidden rounded-lg border border-line bg-surface-2"
                      >
                        <button
                          type="button"
                          title={t('symbols.copyTitle', { label: symbol.label, value: symbol.source })}
                          onClick={() => void copySymbol(symbol)}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-2 text-left hover:bg-accent-soft"
                        >
                          <span className="min-w-8 text-center font-serif text-xl text-ink">
                            {symbol.display}
                          </span>
                          <span className="min-w-0 truncate font-mono text-xs text-muted">
                            {symbol.source}
                          </span>
                        </button>
                        {editing && (
                          <button
                            type="button"
                            aria-label={t('symbols.remove', { label: symbol.label })}
                            onClick={() => removeSymbol(symbol.id)}
                            className="flex w-9 shrink-0 cursor-pointer items-center justify-center border-l border-line text-muted hover:bg-red-50 hover:text-danger"
                          >
                            <TrashIcon size={15} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
            {state.symbols.length === 0 && (
              <p className="rounded-lg border border-dashed border-line-strong p-4 text-center text-sm text-muted">
                {t('symbols.empty')}
              </p>
            )}

            {editing && (
              <form onSubmit={addSymbol} className="mt-6 flex flex-col gap-3 border-t border-line pt-5">
                <h3 className="m-0 text-sm font-bold">{t('symbols.add')}</h3>
                <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
                  {t('symbols.label')}
                  <input
                    className={inputCls}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    maxLength={40}
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
                  {t('symbols.display')}
                  <input
                    className={inputCls}
                    value={display}
                    onChange={(event) => setDisplay(event.target.value)}
                    maxLength={32}
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted">
                  {t('symbols.copyValue')}
                  <input
                    className={`${inputCls} font-mono`}
                    value={source}
                    onChange={(event) => setSource(event.target.value)}
                    maxLength={80}
                    required
                  />
                </label>
                <button
                  type="submit"
                  className={`${btn('secondary', 'sm')} self-start`}
                  disabled={!label.trim() || !display.trim() || !source.trim()}
                >
                  {t('symbols.add')}
                </button>
              </form>
            )}
          </div>

          <footer className="flex flex-col gap-2 border-t border-line px-5 py-3">
            {editing && (
              <button type="button" className={`${btn('danger', 'sm')} w-full`} onClick={resetSymbols}>
                {t('symbols.resetGrid')}
              </button>
            )}
            <button
              type="button"
              aria-pressed={editing}
              className={`${btn(editing ? 'primary' : 'secondary', 'sm')} w-full`}
              onClick={() => setEditing((current) => !current)}
            >
              <PenIcon size={16} />
              {t(editing ? 'symbols.doneEditing' : 'symbols.editGrid')}
            </button>
            <div aria-live="polite" className="min-h-5 text-sm text-muted">
              {copyMessage}
            </div>
          </footer>
        </aside>
      )}
    </>
  )
}
