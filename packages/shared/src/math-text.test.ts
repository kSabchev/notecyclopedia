import { describe, expect, it } from 'vitest'
import { docToText } from './doc'
import { inlineContent, markdownBlocks, tidyDoc, tidyLatex } from './math-text'
import type { DocJSON } from './types'

const math = (latex: string) => ({ type: 'mathInline', attrs: { latex } })
const text = (t: string) => ({ type: 'text', text: t })

describe('tidyLatex', () => {
  it('writes word subscripts as upright text, leaving indices and single letters alone', () => {
    expect(tidyLatex('a_{tr}=\\frac{a_{par}+a_{tar}}{2}')).toBe(
      'a_{\\text{tr}}=\\frac{a_{\\text{par}}+a_{\\text{tar}}}{2}',
    )
    expect(tidyLatex('v_{esc} = \\sqrt{2\\mu / r}')).toBe('v_{\\text{esc}} = \\sqrt{2\\mu / r}')
    expect(tidyLatex('T^{max}')).toBe('T^{\\text{max}}')
    for (const kept of ['a_{ij}', 'r_{xy}', 'a_p', 'v_{1}', 'v_{\\text{esc}}', 'x_{\\mathrm{sc}}'])
      expect(tidyLatex(kept), kept).toBe(kept)
  })

  it('uses \\cdot for a multiplication star, keeping x^* and a_*', () => {
    expect(tidyLatex('2 * \\pi * r')).toBe('2 \\cdot \\pi \\cdot r')
    expect(tidyLatex('x^* + a_*')).toBe('x^* + a_*')
  })

  it('drops \\displaystyle and collapses spaces', () => {
    expect(tidyLatex('  \\displaystyle  \\frac{1}{2}   m v^2 ')).toBe('\\frac{1}{2} m v^2')
  })
})

describe('inlineContent', () => {
  it('turns $…$ and \\(…\\) into math nodes, but not money', () => {
    expect(inlineContent('radius $a_{par}$ and \\(\\mu\\), costing $5 and $10, or \\$3')).toEqual([
      text('radius '),
      math('a_{\\text{par}}'),
      text(' and '),
      math('\\mu'),
      text(', costing $5 and $10, or $3'),
    ])
    expect(inlineContent('$x$')).toEqual([math('x')])
  })

  it('reads the AI’s Markdown when asked: bold, italic and code, with math inside bold', () => {
    expect(inlineContent('**speed $v$** is *fast*, see `v_esc`', { markdown: true })).toEqual([
      { type: 'text', text: 'speed ', marks: [{ type: 'bold' }] },
      math('v'),
      text(' is '),
      { type: 'text', text: 'fast', marks: [{ type: 'italic' }] },
      text(', see '),
      { type: 'text', text: 'v_esc', marks: [{ type: 'code' }] },
    ])
    // Without markdown, asterisks stay as typed.
    expect(inlineContent('a **b**')).toEqual([text('a **b**')])
  })
})

describe('markdownBlocks', () => {
  it('turns the daily question that came out as raw LaTeX into readable math', () => {
    const blocks = markdownBlocks(
      "In a Hohmann transfer from a circular parking orbit of radius $a_{par}$ to a circular target orbit of radius $a_{tar}$, the notes give the transfer ellipse's semi-major axis as $a_{tr}=\\frac{a_{par}+a_{tar}}{2}$.",
    )
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        content: [
          text('In a Hohmann transfer from a circular parking orbit of radius '),
          math('a_{\\text{par}}'),
          text(' to a circular target orbit of radius '),
          math('a_{\\text{tar}}'),
          text(", the notes give the transfer ellipse's semi-major axis as "),
          math('a_{\\text{tr}}=\\frac{a_{\\text{par}}+a_{\\text{tar}}}{2}'),
          text('.'),
        ],
      },
    ])
  })

  it('splits display math out of a paragraph, and reads numbered lists and headings', () => {
    expect(markdownBlocks('The speed is $$v = \\sqrt{\\mu / r}$$ at radius $r$.')).toEqual([
      { type: 'paragraph', content: [text('The speed is')] },
      { type: 'formula', attrs: { latex: 'v = \\sqrt{\\mu / r}', pinned: false } },
      { type: 'paragraph', content: [text('at radius '), math('r'), text('.')] },
    ])
    expect(markdownBlocks('## Steps\n\n1. Raise\n2. Circularise')).toEqual([
      { type: 'heading', attrs: { level: 3 }, content: [text('Steps')] },
      {
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [text('Raise')] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [text('Circularise')] }] },
        ],
      },
    ])
  })
})

describe('tidyDoc', () => {
  it('converts math left as text in older pages and tidies formulas, counting the changes', () => {
    const doc: DocJSON = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [text('Radius $a_{par}$, '), { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '$a_{par}$', marks: [{ type: 'code' }] }] },
        { type: 'codeBlock', content: [text('price = $x$')] },
        { type: 'formula', attrs: { id: 'f1', latex: 'v_{esc} = \\sqrt{2 * \\mu / r}' } },
      ],
    }
    const { doc: tidied, changes } = tidyDoc(doc)
    expect(changes).toBe(2)
    expect(tidied.content?.[0]).toEqual({
      type: 'paragraph',
      content: [
        text('Radius '),
        math('a_{\\text{par}}'),
        text(', '),
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      ],
    })
    // Code is left as written.
    expect(tidied.content?.[1]).toEqual(doc.content?.[1])
    expect(tidied.content?.[2]).toEqual(doc.content?.[2])
    expect(tidied.content?.[3]).toEqual({
      type: 'formula',
      attrs: { id: 'f1', latex: 'v_{\\text{esc}} = \\sqrt{2 \\cdot \\mu / r}' },
    })
    expect(tidyDoc(tidied).changes).toBe(0)
    // Search and AI context still read inline math as $…$.
    expect(docToText(tidied)).toContain('Radius $a_{\\text{par}}$, bold')
  })
})
