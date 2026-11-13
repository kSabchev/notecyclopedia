import assert from 'node:assert/strict'
import { test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import type { createMessage } from '../claude-client'
import { type PlanPage, planDays } from './exam-plan'
import { generateQuickCheck } from './quick-check'

const page = (id: string, title: string): PlanPage => ({
  id,
  title,
  type: 'lecture',
  lectureNumber: null,
  sections: [],
})
const pages = [page('p1', 'Kepler orbits'), page('p2', 'Hohmann transfers')]

test('a plan draft becomes study dates with links to the course pages', () => {
  const days = planDays(
    {
      title: 'Exam',
      days: [
        { day: 3, items: [{ ref: 'P2', focus: 'Rework the transfer examples' }] },
        { day: 1, items: [{ ref: 'P1', focus: 'Read the lecture' }] },
        // Named twice: merged into one day.
        { day: 1, items: [{ ref: null, focus: 'Flashcards of the formulas' }] },
        // Unknown page: the task stays, without a link.
        { day: 2, items: [{ ref: 'P9', focus: 'Practice set' }] },
        // Outside the plan, or empty: dropped.
        { day: 0, items: [{ ref: 'P1', focus: 'Too early' }] },
        { day: 5, items: [{ ref: 'P1', focus: 'Exam day' }] },
        { day: 4, items: [] },
      ],
    },
    pages,
    // Study days only: the weekend of 2–3 January is skipped.
    ['2026-12-30', '2026-12-31', '2027-01-04', '2027-01-05'],
  )
  assert.deepEqual(
    days.map((d) => [d.date, d.items.map((i) => [i.pageId, i.pageTitle, i.focus, i.done])]),
    [
      [
        '2026-12-30',
        [
          ['p1', 'Kepler orbits', 'Read the lecture', false],
          [null, null, 'Flashcards of the formulas', false],
        ],
      ],
      ['2026-12-31', [[null, null, 'Practice set', false]]],
      ['2027-01-04', [['p2', 'Hohmann transfers', 'Rework the transfer examples', false]]],
    ],
  )
  const ids = days.flatMap((d) => d.items.map((i) => i.id))
  assert.equal(new Set(ids).size, ids.length, 'Each item has its own id')
})

test('a quick check asks about the explanation and keeps two or three questions', async () => {
  let prompt = ''
  const create = (async (request: Anthropic.MessageCreateParamsNonStreaming) => {
    prompt = JSON.stringify(request.messages)
    return {
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 't',
          name: 'quick_check',
          input: {
            questions: [
              { question: 'Why are two burns needed?', answer: 'One raises apoapsis, one circularises.' },
              { question: 'What if the target orbit were lower?', answer: 'Both burns are retrograde.' },
            ],
          },
        },
      ],
    } as unknown as Anthropic.Message
  }) as typeof createMessage
  const check = await generateQuickCheck(
    'Why two burns?',
    'A Hohmann transfer uses two burns.',
    'u',
    'en',
    create,
  )
  assert.equal(check.questions.length, 2)
  assert.match(prompt, /Why two burns\?/)
  assert.match(prompt, /A Hohmann transfer uses two burns\./)

  const broken = (async () =>
    ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'No questions' }],
    }) as unknown as Anthropic.Message) as typeof createMessage
  await assert.rejects(generateQuickCheck('q', 'a', 'u', 'en', broken), /invalid questions/)
})
