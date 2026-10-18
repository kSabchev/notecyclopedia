import katex from 'katex'
import { useMemo } from 'react'

/** Render LaTeX with KaTeX. Invalid input is shown in red instead of throwing. */
export function Tex({
  latex,
  display = false,
  className = '',
}: { latex: string; display?: boolean; className?: string }) {
  const html = useMemo(
    () =>
      katex.renderToString(latex || '\\square', {
        displayMode: display,
        throwOnError: false,
        output: 'html',
        strict: 'ignore',
      }),
    [latex, display],
  )
  // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is sanitized markup generated from the formula
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
