import { describe, expect, it } from 'vitest'
import { diffLines, docBlocks } from './diff'

describe('revision diff', () => {
  it('splits a document into top-level blocks, formulas as LaTeX', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Orbits' }] },
        { type: 'paragraph' },
        { type: 'formula', attrs: { latex: 'r_p = a(1-e)' } },
      ],
    }
    expect(docBlocks(doc)).toEqual(['Orbits', '$r_p = a(1-e)$'])
  })

  it('marks added, removed and unchanged lines in order', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual([
      { op: 'same', text: 'a' },
      { op: 'remove', text: 'b' },
      { op: 'add', text: 'x' },
      { op: 'same', text: 'c' },
      { op: 'add', text: 'd' },
    ])
  })

  it('handles empty sides', () => {
    expect(diffLines([], ['a'])).toEqual([{ op: 'add', text: 'a' }])
    expect(diffLines(['a'], [])).toEqual([{ op: 'remove', text: 'a' }])
  })
})
