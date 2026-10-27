import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePageReviewResponse } from './page-review'

const response = (input: unknown, stop_reason = 'tool_use') => ({
  stop_reason,
  content: [{ type: 'tool_use', input }],
})

test('parses review notes and preserves revised TipTap structure', () => {
  const content = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Overview', marks: [{ type: 'bold' }] }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'See source',
            marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          },
        ],
      },
      { type: 'formula', attrs: { latex: 'E = mc^2', label: '1', description: null, pinned: true } },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Point' }] }] },
        ],
      },
    ],
  }
  const draft = parsePageReviewResponse(
    response({ findings: ['Verify the cited value.'], content: JSON.stringify(content) }),
  )

  assert.deepEqual(draft.findings, ['Verify the cited value.'])
  assert.deepEqual(draft.content, content)
})

test('rejects invalid TipTap nodes and structure', () => {
  assert.throws(
    () =>
      parsePageReviewResponse(
        response({
          findings: [],
          content: JSON.stringify({ type: 'doc', content: [{ type: 'text', text: 'invalid' }] }),
        }),
      ),
    /invalid page draft/,
  )
})

test('rejects malformed or invalid document JSON', () => {
  assert.throws(
    () => parsePageReviewResponse(response({ findings: [], content: '{' })),
    /invalid page draft/,
  )
  assert.throws(
    () =>
      parsePageReviewResponse(
        response({ findings: [], content: JSON.stringify({ type: 'doc' }) }),
      ),
    /invalid page draft/,
  )
})

test('reports output truncation and missing tool output', () => {
  assert.throws(() => parsePageReviewResponse(response({}, 'max_tokens')), /exceeded the AI output limit/)
  assert.throws(
    () => parsePageReviewResponse({ stop_reason: 'end_turn', content: [{ type: 'text' }] }),
    /did not return a page review/,
  )
})
