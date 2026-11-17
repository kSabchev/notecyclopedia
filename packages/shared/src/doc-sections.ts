import type { DocJSON } from './types'

/** The parts of a document node this module reads. */
export type DocBlock = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: DocBlock[] }

/** The text before a page's first heading, as a section of its own. */
export const INTRO_SECTION = 'intro'

/** A part of a page that can be reviewed on its own: blocks `start` to `end` (exclusive) of the document. */
export interface DocSection {
  /** The heading's id, or `INTRO_SECTION`. */
  id: string
  /** The heading's text; empty for the intro. */
  title: string
  /** 2 or 3 for headings, 0 for the intro. */
  level: number
  start: number
  end: number
}

const textOf = (node: DocBlock): string =>
  node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('')

/**
 * A page's sections: the intro (blocks before the first heading, when there are any), then each heading with the
 * blocks under it, up to the next heading of the same or a higher level. A level-3 heading inside a level-2 section is
 * also a section of its own.
 */
export function docSections(doc: DocJSON): DocSection[] {
  const blocks = (doc.content ?? []) as DocBlock[]
  const headings = blocks.flatMap((node, index) =>
    node.type === 'heading' && typeof node.attrs?.id === 'string'
      ? [
          {
            index,
            id: node.attrs.id as string,
            level: Number(node.attrs.level) || 2,
            title: textOf(node).trim(),
          },
        ]
      : [],
  )
  const sections: DocSection[] = []
  const first = headings[0]?.index ?? blocks.length
  if (first > 0 && headings.length)
    sections.push({ id: INTRO_SECTION, title: '', level: 0, start: 0, end: first })
  headings.forEach((h, i) => {
    const next = headings.slice(i + 1).find((other) => other.level <= h.level)
    sections.push({
      id: h.id,
      title: h.title,
      level: h.level,
      start: h.index,
      end: next?.index ?? blocks.length,
    })
  })
  return sections
}

/** The document with blocks `start` to `end` of `doc` replaced by `blocks`. */
export function replaceSection(
  doc: DocJSON,
  section: Pick<DocSection, 'start' | 'end'>,
  blocks: DocBlock[],
): DocJSON {
  const content = (doc.content ?? []) as DocBlock[]
  return { ...doc, content: [...content.slice(0, section.start), ...blocks, ...content.slice(section.end)] }
}

/** The most output a page review may use; a revised page longer than this is cut off. */
export const REVIEW_MAX_TOKENS = 8192

/**
 * About how many output tokens a review of these blocks needs: the revised blocks come back as a JSON string inside
 * JSON, at roughly three characters a token, plus room for the findings. An estimate, to warn before a paid call.
 */
export function reviewTokens(blocks: DocBlock[]): number {
  return Math.round(JSON.stringify(JSON.stringify({ type: 'doc', content: blocks })).length / 3) + 400
}

/** Whether a review of these blocks probably fits the output limit. */
export const reviewFits = (blocks: DocBlock[]) => reviewTokens(blocks) <= REVIEW_MAX_TOKENS

/** Blocks `start` to `end` of a page reviewed in one call, and the chosen sections they cover. */
export interface ReviewPart {
  start: number
  end: number
  sections: Pick<DocSection, 'id' | 'title'>[]
}

/**
 * The calls a review of the chosen sections needs. A subsection inside a chosen section is already covered; sections
 * next to each other share a call while their blocks fit one review. Unknown ids are left out (see `missing`).
 */
export function reviewParts(doc: DocJSON, ids: string[]): { parts: ReviewPart[]; missing: string[] } {
  const all = docSections(doc)
  const chosen = all.filter((s) => ids.includes(s.id))
  const missing = ids.filter((id) => !all.some((s) => s.id === id))
  const outer = chosen
    .filter(
      (s) =>
        !chosen.some(
          (o) => o !== s && o.start <= s.start && s.end <= o.end && o.end - o.start > s.end - s.start,
        ),
    )
    .sort((a, b) => a.start - b.start)
  const blocks = (doc.content ?? []) as DocBlock[]
  const parts: ReviewPart[] = []
  for (const s of outer) {
    const last = parts.at(-1)
    if (last && last.end === s.start && reviewFits(blocks.slice(last.start, s.end))) {
      last.end = s.end
      last.sections.push({ id: s.id, title: s.title })
    } else parts.push({ start: s.start, end: s.end, sections: [{ id: s.id, title: s.title }] })
  }
  return { parts, missing }
}

/** The document with each part's blocks replaced by its revision (parts must not overlap). */
export function replaceParts(
  doc: DocJSON,
  revisions: { part: Pick<ReviewPart, 'start' | 'end'>; blocks: DocBlock[] }[],
) {
  // From the last part to the first, so earlier positions stay valid.
  return [...revisions]
    .sort((a, b) => b.part.start - a.part.start)
    .reduce((next, r) => replaceSection(next, r.part, r.blocks), doc)
}
