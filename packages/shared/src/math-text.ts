import type { DocJSON } from './types'

/**
 * Turning AI-written text into presentable page content, without AI: inline math (`$…$`, `\(…\)`) becomes math
 * nodes instead of raw dollar signs, and formulas get a conservative LaTeX tidy-up (word subscripts as text, `*` as
 * `\cdot`). Used wherever AI text lands on a page, and by **Tidy formulas** in the editor for older pages.
 */

type Mark = { type: string; attrs?: Record<string, unknown> }
export type InlineNode =
  | { type: 'text'; text: string; marks?: Mark[] }
  | { type: 'mathInline'; attrs: { latex: string } }

/** Two-letter subscripts that are words (transfer, equatorial…), not two indices like `ij` or `xy`. */
const WORD_PAIRS = new Set(['tr', 'eq', 'sc', 'sp', 'el', 'cm', 'in', 'ex', 'pk', 'ap', 'pe'])

/**
 * A conservative clean-up of LaTeX written by the AI:
 * - word subscripts and superscripts become upright text: `a_{par}` → `a_{\text{par}}` (three letters or more, or a
 *   known two-letter word; `a_{ij}`, `a_p` and existing `\text`/`\mathrm` are left alone);
 * - `*` between factors becomes `\cdot` (`x^*` and `a_*` are kept);
 * - `\displaystyle` is dropped (blocks decide display style) and runs of spaces collapse.
 */
export function tidyLatex(latex: string): string {
  return latex
    .replace(/\\displaystyle\s*/g, '')
    .replace(/([_^])\{([A-Za-z]+(?:[ ,\-][A-Za-z]+)*)\}/g, (all, op: string, word: string) =>
      word.replace(/[ ,-]/g, '').length >= 3 || WORD_PAIRS.has(word) ? `${op}{\\text{${word}}}` : all,
    )
    .replace(/([\w})\]])\s*\*\s*(?=[\w\\({[])/g, '$1 \\cdot ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Inline math as in Markdown renderers: `\(…\)`, or `$…$` whose opening `$` is not followed by a space and whose
 * closing `$` is not preceded by a space or followed by a digit, so "$5 and $10" stays money. `$$` is display math,
 * handled by the block converter.
 */
const MATH = String.raw`\\\((.+?)\\\)|(?<![\\$])\$(?![\s$])([^$\n]*?[^\s$\\])\$(?![\d$])`
const MARKDOWN = String.raw`\x60([^\x60\n]+)\x60|\*\*(.+?)\*\*|(?<![*\w])\*(?![\s*])([^*\n]*?[^\s*])\*(?![*\w])`

/**
 * Inline nodes for a line of text: math as math nodes; with `markdown`, also **bold**, *italic* and `code` from the
 * AI's Markdown. `marks` apply to all the text (math nodes carry no marks). Escaped `\$` becomes `$`.
 */
export function inlineContent(text: string, opts: { markdown?: boolean; marks?: Mark[] } = {}): InlineNode[] {
  const marks = opts.marks ?? []
  const pattern = new RegExp(opts.markdown ? `${MATH}|${MARKDOWN}` : MATH, 'g')
  const out: InlineNode[] = []
  const pushText = (t: string, extra: Mark[] = []) => {
    const value = t.replace(/\\\$/g, '$')
    if (!value) return
    const all = [...marks, ...extra]
    out.push(all.length ? { type: 'text', text: value, marks: all } : { type: 'text', text: value })
  }
  let last = 0
  for (const m of text.matchAll(pattern)) {
    const index = m.index ?? 0
    pushText(text.slice(last, index))
    const [, paren, dollar, code, bold, italic] = m
    if (paren !== undefined || dollar !== undefined)
      out.push({ type: 'mathInline', attrs: { latex: tidyLatex((paren ?? dollar) as string) } })
    else if (code !== undefined) pushText(code, [{ type: 'code' }])
    else if (bold !== undefined)
      out.push(...inlineContent(bold, { markdown: true, marks: [...marks, { type: 'bold' }] }))
    else if (italic !== undefined)
      out.push(...inlineContent(italic, { markdown: true, marks: [...marks, { type: 'italic' }] }))
    last = index + m[0].length
  }
  pushText(text.slice(last))
  return out
}

type Node = {
  type: string
  text?: string
  marks?: Mark[]
  attrs?: Record<string, unknown>
  content?: Node[]
}

/**
 * The document with math written as text (`$…$` left by older AI saves or pasted in) turned into math nodes, and every
 * formula's LaTeX tidied. Text in code is left alone. `changes` counts what changed, for "Tidied 3 formulas".
 */
export function tidyDoc(doc: DocJSON): { doc: DocJSON; changes: number } {
  let changes = 0
  const visit = (node: Node): Node => {
    if ((node.type === 'formula' || node.type === 'mathInline') && typeof node.attrs?.latex === 'string') {
      const latex = tidyLatex(node.attrs.latex)
      if (latex === node.attrs.latex) return node
      changes++
      return { ...node, attrs: { ...node.attrs, latex } }
    }
    if (!node.content || node.type === 'codeBlock') return node
    const content = node.content.flatMap((child): Node[] => {
      if (child.type !== 'text' || !child.text || child.marks?.some((m) => m.type === 'code'))
        return [visit(child)]
      const parts = inlineContent(child.text, { marks: child.marks })
      const math = parts.filter((p) => p.type === 'mathInline').length
      if (!math) return [child]
      changes += math
      return parts as Node[]
    })
    return { ...node, content }
  }
  const tidied = visit(doc as unknown as Node) as unknown as DocJSON
  return { doc: tidied, changes }
}

/**
 * Page blocks from Markdown written by the AI: paragraphs separated by blank lines, `$$…$$` as formula blocks (also
 * in the middle of a paragraph), `- ` and `1. ` lines as lists, `#` lines as headings, and inline math, **bold**,
 * *italic* and `code` within the text.
 */
export function markdownBlocks(markdown: string): unknown[] {
  const inline = (line: string) => inlineContent(line, { markdown: true })
  // Display math gets a paragraph of its own.
  const separated = markdown.replace(/\$\$([\s\S]+?)\$\$/g, (_all, latex: string) => `\n\n$$${latex}$$\n\n`)
  return separated
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const display = /^\$\$([\s\S]+)\$\$$/.exec(p)
      if (display)
        return { type: 'formula', attrs: { latex: tidyLatex(display[1] as string), pinned: false } }
      const lines = p.split('\n').map((l) => l.trim())
      const list = (pattern: RegExp, type: 'bulletList' | 'orderedList') =>
        lines.every((l) => pattern.test(l))
          ? {
              type,
              content: lines.map((l) => ({
                type: 'listItem',
                content: [{ type: 'paragraph', content: inline(l.replace(pattern, '')) }],
              })),
            }
          : null
      const bullets = list(/^[-*] +/, 'bulletList') ?? list(/^\d+[.)] +/, 'orderedList')
      if (bullets) return bullets
      const heading = /^#{1,6}\s+(.+)$/.exec(p)
      if (heading && lines.length === 1)
        return { type: 'heading', attrs: { level: 3 }, content: inline(heading[1] as string) }
      return { type: 'paragraph', content: inline(lines.join(' ')) }
    })
}
