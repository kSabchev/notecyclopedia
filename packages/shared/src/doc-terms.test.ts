import { describe, expect, it } from 'vitest'
import {
  docToText,
  extractReferences,
  extractTerms,
  pageLink,
  parsePageLink,
  remapPageLinks,
  sectionOf,
  withBlockIds,
} from './doc'
import { markdownBlocks } from './math-text'
import type { DocJSON } from './types'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const link = (text: string, href: string) => ({
  type: 'text',
  text,
  marks: [{ type: 'link', attrs: { href } }],
})

const doc: DocJSON = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2, id: 'h-transfer' },
      content: [{ type: 'text', text: 'Hohmann transfer' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See ' },
        link('vis-viva', pageLink(A, 'h-visviva')),
        { type: 'text', text: ' and ' },
        link('lecture 1', pageLink(A)),
        { type: 'text', text: ', ' },
        link('again', pageLink(A, 'h-visviva')),
        link('an article', 'https://example.org/pages/x'),
      ],
    },
    { type: 'heading', attrs: { level: 3, id: 'h-dv' }, content: [{ type: 'text', text: 'Δv budget' }] },
    { type: 'heading', attrs: { level: 3 }, content: [] },
  ],
}

describe('terms and references', () => {
  it('gives headings ids alongside formulas', () => {
    const plain: DocJSON = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'One' }] },
        { type: 'heading', attrs: { level: 2, id: 'same' }, content: [{ type: 'text', text: 'Two' }] },
        // Splitting a heading copies its id; the later copy gets a new one.
        { type: 'heading', attrs: { level: 2, id: 'same' }, content: [{ type: 'text', text: 'Three' }] },
      ],
    }
    let n = 0
    const { doc: out } = withBlockIds(plain, () => `new-${++n}`)
    expect(extractTerms(out).map((t) => t.nodeId)).toEqual(['new-1', 'same', 'new-2'])
  })

  it('lists headings with text as terms', () => {
    expect(extractTerms(doc)).toEqual([
      { nodeId: 'h-transfer', text: 'Hohmann transfer', level: 2 },
      { nodeId: 'h-dv', text: 'Δv budget', level: 3 },
    ])
  })

  it('finds in-app references to pages and terms, once each', () => {
    expect(extractReferences(doc)).toEqual([
      { pageId: A, nodeId: 'h-visviva' },
      { pageId: A, nodeId: null },
    ])
  })

  it('parses only in-app page links', () => {
    expect(parsePageLink(`/pages/${A}#h-1`)).toEqual({ pageId: A, nodeId: 'h-1' })
    expect(parsePageLink(`/pages/${A}`)).toEqual({ pageId: A, nodeId: null })
    expect(parsePageLink('https://example.org/pages/x')).toBeNull()
    expect(parsePageLink(`/pages/${A}/edit`)).toBeNull()
  })

  it('points references at imported copies of pages', () => {
    const out = remapPageLinks(doc, (id) => (id === A ? B : undefined))
    expect(extractReferences(out)).toEqual([
      { pageId: B, nodeId: 'h-visviva' },
      { pageId: B, nodeId: null },
    ])
    expect(JSON.stringify(out)).toContain('https://example.org/pages/x')
  })
})

describe('sections and Markdown blocks', () => {
  const h = (level: number, id: string, text: string) => ({
    type: 'heading',
    attrs: { level, id },
    content: [{ type: 'text', text }],
  })
  const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const lecture: DocJSON = {
    type: 'doc',
    content: [p('intro'), h(2, 'a', 'A'), p('a1'), h(3, 'a2', 'A.2'), p('a2'), h(2, 'b', 'B'), p('b1')],
  }

  it('cuts a section up to the next heading of the same level', () => {
    expect(docToText(sectionOf(lecture, 'a'))).toBe('A\na1\nA.2\na2')
    expect(docToText(sectionOf(lecture, 'a2'))).toBe('A.2\na2')
    expect(sectionOf(lecture, 'missing')).toBe(lecture)
  })

  it('turns AI Markdown into page blocks', () => {
    expect(
      markdownBlocks('Two **burns** are used.\n\n$$Delta v = v_2 - v_1$$\n\n- raise\n- circularise'),
    ).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Two ' },
          { type: 'text', text: 'burns', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' are used.' },
        ],
      },
      { type: 'formula', attrs: { latex: 'Delta v = v_2 - v_1', pinned: false } },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'raise' }] }] },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'circularise' }] }],
          },
        ],
      },
    ])
  })
})
