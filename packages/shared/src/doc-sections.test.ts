import { describe, expect, it } from 'vitest'
import { INTRO_SECTION, docSections, replaceSection, reviewFits, reviewTokens } from './doc-sections'
import type { DocJSON } from './types'

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const h = (id: string, level: number, text: string) => ({
  type: 'heading',
  attrs: { id, level },
  content: [{ type: 'text', text }],
})
const doc: DocJSON = {
  type: 'doc',
  content: [
    p('Intro'),
    h('a', 2, 'Kepler'),
    p('A1'),
    h('b', 3, 'Second law'),
    p('B1'),
    h('c', 2, 'Vis-viva'),
    p('C1'),
  ],
}

describe('docSections', () => {
  it('lists the intro, then each heading up to the next of the same or higher level', () => {
    expect(docSections(doc).map((s) => [s.id, s.title, s.start, s.end])).toEqual([
      [INTRO_SECTION, '', 0, 1],
      ['a', 'Kepler', 1, 5],
      ['b', 'Second law', 3, 5],
      ['c', 'Vis-viva', 5, 7],
    ])
  })

  it('has no sections without headings, and no intro when the page starts with one', () => {
    expect(docSections({ type: 'doc', content: [p('Only text')] })).toEqual([])
    expect(docSections({ type: 'doc', content: [h('x', 2, 'X'), p('x')] }).map((s) => s.id)).toEqual(['x'])
  })
})

describe('replaceSection', () => {
  it('puts the revised blocks in place of the section, leaving the rest', () => {
    const b = docSections(doc).find((s) => s.id === 'b')
    if (!b) throw new Error('no section b')
    const next = replaceSection(doc, b, [h('b', 3, 'Second law'), p('B1, clearer')])
    expect((next.content as { content?: { text?: string }[] }[]).map((n) => n.content?.[0]?.text)).toEqual([
      'Intro',
      'Kepler',
      'A1',
      'Second law',
      'B1, clearer',
      'Vis-viva',
      'C1',
    ])
  })
})

describe('reviewTokens', () => {
  it('grows with the content, and a long page does not fit one review', () => {
    expect(reviewTokens([p('short')])).toBeLessThan(reviewTokens([p('short'), p('x'.repeat(1000))]))
    expect(reviewFits([p('short')])).toBe(true)
    expect(reviewFits(Array.from({ length: 200 }, (_, i) => p(`Paragraph ${i} `.repeat(20))))).toBe(false)
  })
})
