import { describe, expect, it } from 'vitest'
import {
  INTRO_SECTION,
  docSections,
  replaceParts,
  replaceSection,
  reviewFits,
  reviewParts,
  reviewTokens,
} from './doc-sections'
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

describe('reviewParts', () => {
  it('covers a chosen subsection by its chosen parent, and merges neighbours that fit together', () => {
    const { parts, missing } = reviewParts(doc, ['b', 'a', 'c', 'gone'])
    expect(missing).toEqual(['gone'])
    expect(parts.map((p) => [p.start, p.end, p.sections.map((s) => s.id)])).toEqual([[1, 7, ['a', 'c']]])
  })

  it('keeps sections apart when they are not next to each other', () => {
    const { parts } = reviewParts(doc, [INTRO_SECTION, 'c'])
    expect(parts.map((p) => [p.start, p.end])).toEqual([
      [0, 1],
      [5, 7],
    ])
  })

  it('keeps neighbours apart when together they would not fit one review', () => {
    const long = (id: string) => [
      h(id, 2, id),
      ...Array.from({ length: 100 }, (_, i) => p(`${id} ${i} `.repeat(20))),
    ]
    const big: DocJSON = { type: 'doc', content: [...long('x'), ...long('y')] }
    expect(reviewParts(big, ['x', 'y']).parts).toHaveLength(2)
  })
})

describe('replaceParts', () => {
  it('replaces several parts, whatever their order', () => {
    const next = replaceParts(doc, [
      { part: { start: 0, end: 1 }, blocks: [p('Intro, revised')] },
      { part: { start: 5, end: 7 }, blocks: [h('c', 2, 'Vis-viva'), p('C1, revised')] },
    ])
    expect((next.content as { content?: { text?: string }[] }[]).map((n) => n.content?.[0]?.text)).toEqual([
      'Intro, revised',
      'Kepler',
      'A1',
      'Second law',
      'B1',
      'Vis-viva',
      'C1, revised',
    ])
  })
})
