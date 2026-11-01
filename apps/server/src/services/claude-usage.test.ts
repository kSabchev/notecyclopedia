import assert from 'node:assert/strict'
import { test } from 'node:test'
import { env } from '../env'
import { HttpError } from '../http'
import { estimateCost, requireAdmin } from './claude-usage'

test('estimates Claude Sonnet 5.5 cost including prompt-cache tokens', () => {
  assert.equal(
    estimateCost('claude-sonnet-5-5-20261001', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 1_000_000,
        ephemeral_1h_input_tokens: 1_000_000,
      },
    }),
    '18.70000000',
  )
})

test('does not estimate cost for a model without configured pricing', () => {
  assert.equal(estimateCost('unknown-model', { input_tokens: 100, output_tokens: 100 }), null)
})

test('restricts Claude usage access to allowlisted email addresses', () => {
  const email = 'usage-test-admin@example.invalid'
  const wasAllowlisted = env.adminEmails.has(email)
  env.adminEmails.add(email)
  try {
    requireAdmin(` ${email.toUpperCase()} `)
    assert.throws(
      () => requireAdmin('not-an-admin@example.invalid'),
      (error) => error instanceof HttpError && error.status === 403,
    )
  } finally {
    if (!wasAllowlisted) env.adminEmails.delete(email)
  }
})
