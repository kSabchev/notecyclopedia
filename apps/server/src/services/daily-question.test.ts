import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DailyQuestion } from '@nc/shared'
import { type TopicCandidate, addUsage, pickTopic, questionBlocks } from './daily-question'

const topic = (pageId: string, nodeId: string | null): TopicCandidate => ({
  pageId,
  nodeId,
  pageTitle: pageId,
  courseId: 'c',
  topic: `${pageId}/${nodeId}`,
})
// Newest lecture first, as topicCandidates returns them.
const candidates = [topic('l5', 'a'), topic('l5', 'b'), topic('l4', 'c'), topic('l4', null)]

const asked = (pageId: string, nodeId: string | null, day: number) => ({
  pageId,
  nodeId,
  createdAt: new Date(2026, 10, day),
})

test('picks a topic never asked about, from the newest lectures', () => {
  const picked = pickTopic(candidates, [asked('l5', 'a', 1)], () => 0)
  assert.deepEqual(picked, topic('l5', 'b'))
  // Only the first `pool` candidates are considered, so older lectures wait their turn.
  assert.deepEqual(
    pickTopic(candidates, [], () => 0.99, 2),
    topic('l5', 'b'),
  )
})

test('once every topic was asked about, picks the one asked about longest ago', () => {
  const history = [
    asked('l5', 'a', 9),
    asked('l4', 'c', 8),
    asked('l5', 'b', 7),
    asked('l4', null, 6),
    // Asked about again later: it is not the oldest any more.
    asked('l4', null, 10),
  ]
  assert.deepEqual(
    pickTopic(candidates, history, () => 0),
    topic('l5', 'b'),
  )
  assert.equal(pickTopic([], []), null)
})

test('adds the usage of later calls to a question', () => {
  const usage = (model: string, cost: number | null) => ({
    models: [model],
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: cost,
  })
  assert.deepEqual(addUsage(usage('a', 0.01), usage('b', 0.02)), {
    models: ['a', 'b'],
    inputTokens: 200,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.03,
  })
  assert.equal(addUsage(usage('a', 0.01), usage('a', null))?.costUsd, null)
  assert.deepEqual(addUsage(null, usage('a', 1)), usage('a', 1))
})

test('a saved question becomes a section with its answer and expansions', () => {
  const question = {
    topic: 'Hohmann transfer',
    question: 'Why two burns?',
    answer: 'The first raises apoapsis.\n\n$$\\Delta v = v_2 - v_1$$',
    expansions: {
      story: 'Apollo used it.',
      advanced: { question: 'And three burns?', answer: 'Bi-elliptic.' },
    },
  } as DailyQuestion
  const blocks = questionBlocks(question, {
    question: 'Question',
    answer: 'Answer',
    story: 'Story',
    advanced: 'Harder question',
  }) as { type: string; content?: { text: string }[]; attrs?: { latex?: string } }[]
  assert.deepEqual(
    blocks.map((b) => b.type),
    [
      'heading',
      'paragraph',
      'paragraph',
      'paragraph',
      'formula',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
    ],
  )
  assert.equal(blocks[0]?.content?.[0]?.text, 'Question: Hohmann transfer')
  assert.equal(blocks[4]?.attrs?.latex, '\\Delta v = v_2 - v_1')
})
