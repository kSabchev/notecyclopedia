import { describe, expect, it } from 'vitest'
import { extractReferences, extractTerms, pageLink, parsePageLink, remapPageLinks, withBlockIds } from './doc'
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
