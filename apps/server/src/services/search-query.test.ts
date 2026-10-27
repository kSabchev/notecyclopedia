import assert from 'node:assert/strict'
import { test } from 'node:test'
import { anyTermQuery } from './search-query'

test('ORs the distinct terms of a question', () => {
  assert.equal(
    anyTermQuery('What is the vis-viva equation? What'),
    "'what' | 'is' | 'the' | 'vis' | 'viva' | 'equation'",
  )
})

test('keeps Bulgarian words and digits', () => {
  assert.equal(anyTermQuery('Какво е закон 2?'), "'какво' | 'е' | 'закон' | '2'")
})

test('drops tsquery operators and quotes', () => {
  assert.equal(anyTermQuery("a' & !b | (c) <-> d:*"), "'a' | 'b' | 'c' | 'd'")
})

test('returns null when there is nothing to search', () => {
  assert.equal(anyTermQuery('  ?!  '), null)
})

test('caps the number of terms', () => {
  assert.equal(anyTermQuery('a b c d', 2), "'a' | 'b'")
})
