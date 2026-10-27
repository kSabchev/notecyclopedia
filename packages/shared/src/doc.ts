import type { DocJSON } from './types'

type Node = { type: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] }

/** Plain text of a TipTap document (for search, AI context and chunking). Formulas become $latex$. */
export function docToText(doc: DocJSON | null | undefined): string {
  const out: string[] = []
  const walk = (n: Node) => {
    if (n.type === 'text' && n.text) out.push(n.text)
    else if (n.type === 'formula') out.push(` $${String(n.attrs?.latex ?? '')}$ `)
    for (const c of n.content ?? []) walk(c)
    if (
      ['paragraph', 'heading', 'listItem', 'formula', 'callout', 'blockquote', 'codeBlock'].includes(n.type)
    )
      out.push('\n')
  }
  for (const c of (doc?.content ?? []) as Node[]) walk(c)
  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Give every formula block a stable `id` attribute so quizzes, calculators and diagrams can refer to it
 * across edits. Existing ids are kept; a repeated id (e.g. from copy-paste) is replaced on the later block.
 */
export function withFormulaIds(
  doc: DocJSON,
  newId: () => string = () => crypto.randomUUID(),
): { doc: DocJSON; changed: boolean } {
  const seen = new Set<string>()
  let changed = false
  const walk = (n: Node): Node => {
    let next = n
    if (n.type === 'formula') {
      const id = n.attrs?.id
      if (typeof id === 'string' && id && !seen.has(id)) seen.add(id)
      else {
        const fresh = newId()
        seen.add(fresh)
        next = { ...n, attrs: { ...n.attrs, id: fresh } }
        changed = true
      }
    }
    if (!n.content) return next
    const content = n.content.map(walk)
    return content.some((c, i) => c !== n.content?.[i]) ? { ...next, content } : next
  }
  const content = (doc.content ?? []) as Node[]
  const mapped = content.map(walk)
  return { doc: changed ? { ...doc, content: mapped } : doc, changed }
}

export interface ExtractedFormula {
  /** The formula block's `id` attribute; null only for documents not passed through `withFormulaIds`. */
  nodeId: string | null
  latex: string
  label: string | null
  description: string | null
  pinned: boolean
}

/** All formula blocks in a document, in order. */
export function extractFormulas(doc: DocJSON | null | undefined): ExtractedFormula[] {
  const found: ExtractedFormula[] = []
  const walk = (n: Node) => {
    if (n.type === 'formula' && n.attrs?.latex) {
      found.push({
        nodeId: typeof n.attrs.id === 'string' && n.attrs.id ? n.attrs.id : null,
        latex: String(n.attrs.latex),
        label: (n.attrs.label as string) || null,
        description: (n.attrs.description as string) || null,
        pinned: Boolean(n.attrs.pinned),
      })
    }
    for (const c of n.content ?? []) walk(c)
  }
  for (const c of (doc?.content ?? []) as Node[]) walk(c)
  return found
}

/** Split text into overlapping chunks of roughly `size` characters, on paragraph boundaries when possible. */
export function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let cur = ''
  for (const p of paras) {
    if (`${cur}\n\n${p}`.length > size && cur) {
      chunks.push(cur)
      cur = cur.slice(-overlap)
    }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size - overlap) chunks.push(p.slice(i, i + size))
      cur = ''
    } else cur = cur ? `${cur}\n\n${p}` : p
  }
  if (cur.trim()) chunks.push(cur)
  return chunks
}
