import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type ChatTurn, boundHistory } from './claude'

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
