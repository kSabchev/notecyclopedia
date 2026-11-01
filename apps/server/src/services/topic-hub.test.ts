import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractReferences, extractTerms, withBlockIds } from '@nc/shared'
import { type HubTarget, hubDocument } from './topic-hub'

const LECTURE = '11111111-1111-4111-8111-111111111111'
const PROBLEM = '22222222-2222-4222-8222-222222222222'
const targets: HubTarget[] = [
  {
    pageId: LECTURE,
    nodeId: 'h-bi',
    label: 'Bi-elliptic transfer',
    pageTitle: 'Orbital manoeuvres',
    pageType: 'lecture',
    lectureNumber: 4,
  },
  {
    pageId: PROBLEM,
    nodeId: null,
    label: 'Hohmann to GEO',
    pageTitle: 'Hohmann to GEO',
    pageType: 'seminar',
    lectureNumber: 4,
  },
]
const draft = {
  overview: 'Transfers move a spacecraft between orbits.\n\nTwo or three burns are used.',
  formulasHeading: 'Key formulas',
  formulas: [{ latex: '\\Delta v = v_2 - v_1', description: 'Velocity change of a burn' }],
  coveredHeading: 'Where it is covered',
  covered: [
    { ref: 'R1', note: 'when three burns are cheaper' },
    { ref: 'R9', note: 'not in the list' },
    { ref: 'R2', note: 'worked example' },
    { ref: 'R1', note: 'again' },
  ],
}

test('a topic hub links only to listed sections and pages, once each', () => {
  const doc = hubDocument(draft, targets)
  assert.deepEqual(extractReferences(doc), [
    { pageId: LECTURE, nodeId: 'h-bi' },
    { pageId: PROBLEM, nodeId: null },
  ])
  const items = JSON.stringify(doc)
  assert.match(items, /"text":" \(Orbital manoeuvres\) — when three burns are cheaper"/)
  assert.match(items, /"text":" — worked example"/)
  // The overview paragraphs and both headings; headings become terms once the page is saved.
  assert.equal(doc.content?.filter((n) => (n as { type: string }).type === 'paragraph').length, 2)
  assert.deepEqual(
    extractTerms(withBlockIds(doc).doc).map((t) => t.text),
    ['Key formulas', 'Where it is covered'],
  )
})

test('empty parts of a topic hub are left out', () => {
  const doc = hubDocument({ ...draft, formulas: [], covered: [{ ref: 'R7', note: '' }] }, targets)
  assert.deepEqual(
    doc.content?.map((n) => (n as { type: string }).type),
    ['paragraph', 'paragraph'],
  )
})
