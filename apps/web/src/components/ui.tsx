import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'dark' | 'ai' | 'ghost' | 'danger'
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-2',
  dark: 'bg-inverse text-inverse-ink hover:bg-inverse-2',
  ai: 'bg-ai text-white hover:brightness-110',
  ghost: 'bg-transparent text-ink hover:bg-line-soft',
  danger: 'bg-surface text-danger border border-line-strong hover:bg-danger-soft',
}

export const btn = (v: Variant = 'secondary', size: 'md' | 'sm' = 'md') =>
  `inline-flex items-center justify-center gap-2 rounded-[10px] font-semibold no-underline transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
    size === 'md' ? 'min-h-11 px-4 text-[15px]' : 'min-h-10 px-3.5 text-sm'
  } ${variants[v]}`

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm' }) {
  return <button type="button" {...rest} className={`${btn(variant, size)} ${className}`} />
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-line bg-surface ${className}`}>{children}</div>
}

export function SectionHeader({ id, title, action }: { id?: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 id={id} className="m-0 text-xl font-bold">
        {title}
      </h2>
      {action && <div className="text-sm font-semibold">{action}</div>}
    </div>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-line-strong p-6 text-center text-muted">
      {children}
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <div
      role="alert"
      className="rounded-[10px] border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger"
    >
      {error instanceof Error ? error.message : String(error)}
    </div>
  )
}

export function FileBadge({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toUpperCase() ?? ''
  const tone =
    ext === 'PDF'
      ? 'bg-ai-soft text-ai-text'
      : ['PPTX', 'PPT', 'DOCX', 'DOC'].includes(ext)
        ? 'bg-accent-soft text-accent'
        : 'bg-line-soft text-ink'
  return (
    <span className={`rounded-md px-2 py-1 font-mono text-xs font-medium ${tone}`}>
      {ext.length > 4 || !ext ? 'FILE' : ext}
    </span>
  )
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-muted">
        {label}
      </label>
      {children}
    </div>
  )
}

export const inputCls = 'h-11 rounded-[10px] border border-line-strong bg-surface px-3 text-ink'
