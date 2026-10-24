import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseArticleDraftResponse } from './article-draft'

const response = (input: unknown, stop_reason = 'tool_use') => ({
  stop_reason,
  content: [{ type: 'tool_use', input }],
})

test('parses a draft with text, formulas, and nullable formula metadata', () => {
  const draft = parseArticleDraftResponse(
    response({
      title: 'Natural environment',
      tags: ['ecology'],
      blocks: [
        { type: 'heading', text: 'Overview' },
        { type: 'paragraph', text: 'Environmental systems interact.' },
        { type: 'formula', latex: 'E = mc^2', label: null, description: null },
      ],
    }),
  )

  assert.equal(draft.title, 'Natural environment')
  assert.deepEqual(draft.tags, ['ecology'])
  assert.equal(draft.content.content?.length, 3)
  assert.deepEqual(draft.content.content?.[2], {
    type: 'formula',
    attrs: { latex: 'E = mc^2', label: null, description: null, pinned: false },
  })
})

test('reports the failing field path for malformed tool output', () => {
  assert.throws(
    () =>
      parseArticleDraftResponse(
        response({ title: 'Bad draft', tags: [], blocks: [{ type: 'paragraph', text: '' }] }),
      ),
    (error: unknown) =>
      error instanceof Error &&
      'status' in error &&
      error.status === 502 &&
      error.message.includes('blocks.0.text'),
  )
})

test('reports output truncation separately from invalid tool output', () => {
  assert.throws(
    () => parseArticleDraftResponse(response({}, 'max_tokens')),
    (error: unknown) =>
      error instanceof Error &&
      'status' in error &&
      error.status === 502 &&
      error.message.includes('output limit'),
  )
})

test('rejects a response with no tool-use block', () => {
  assert.throws(
    () => parseArticleDraftResponse({ stop_reason: 'end_turn', content: [{ type: 'text' }] }),
    /did not return an article draft/,
  )
})
