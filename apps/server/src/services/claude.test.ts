import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatTurn, boundHistory, orbitFromTool } from './claude'

const user = (content: string): ChatTurn => ({ role: 'user', content })
const assistant = (content: string): ChatTurn => ({ role: 'assistant', content })

test('keeps the most recent turns within the character budget', () => {
  const turns = [
    user('a'.repeat(50)),
    assistant('b'.repeat(50)),
    user('c'.repeat(20)),
    assistant('d'.repeat(20)),
  ]
  assert.deepEqual(boundHistory(turns, 60), [turns[2], turns[3]])
})

test('caps the number of turns and starts with a user turn', () => {
  const turns = [user('1'), assistant('2'), user('3'), assistant('4')]
  assert.deepEqual(boundHistory(turns, 1000, 3), [turns[2], turns[3]])
})

test('drops empty turns, which the API rejects', () => {
  const turns = [user('question'), assistant(''), user('again')]
  assert.deepEqual(boundHistory(turns), [turns[0], turns[2]])
})

test('accepts a valid show_orbit call as an orbit widget', () => {
  const result = orbitFromTool({ body: 'earth', a: 26600, e: 0.74, i: 63.4, raan: 0, argp: 270, nu: 0 })
  assert.ok('widget' in result)
  assert.equal(result.widget.kind, 'orbit')
})

test('explains an invalid show_orbit call so Claude can retry', () => {
  const result = orbitFromTool({ body: 'earth', a: 7000, e: 1.3, i: 10, raan: 0, argp: 0, nu: 0 })
  assert.ok('error' in result)
  assert.match(result.error, /elements\.e/)
  assert.match(result.error, /closed orbits/)
})
