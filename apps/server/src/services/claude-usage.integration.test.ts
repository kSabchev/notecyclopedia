import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { migrateTestDatabase, testDatabaseUrl, useTestDatabase } from '../testing/database'

test(
  'API calls are logged with their cost, and the daily AI budget stops a user at the limit',
  {
    skip: !testDatabaseUrl,
  },
  async (t) => {
    if (!testDatabaseUrl) return
    useTestDatabase(testDatabaseUrl, { AI_DAILY_TOKEN_LIMIT: '1000' })
    await migrateTestDatabase()
    const [{ pool, db, schema }, { eq, inArray }, { assertAiBudget, recordClaudeCall }] = await Promise.all([
      import('../db'),
      import('drizzle-orm'),
      import('./claude-usage'),
    ])
    const users = [randomUUID(), randomUUID()]
    const [student, other] = users as [string, string]
    t.after(async () => {
      await db.delete(schema.claudeApiCalls).where(inArray(schema.claudeApiCalls.userId, users))
      await db.delete(schema.user).where(inArray(schema.user.id, users))
      await pool.end()
    })
    await db
      .insert(schema.user)
      .values(users.map((id) => ({ id, name: 'Budget test', email: `budget-${id}@example.test` })))

    const call = (userId: string, usage: Parameters<typeof recordClaudeCall>[0]['usage']) =>
      recordClaudeCall({
        userId,
        operation: 'tutor',
        model: 'claude-sonnet-5-5',
        request: { mode: 'tutor' },
        status: 'succeeded',
        usage,
      })

    await call(student, {
      input_tokens: 400,
      output_tokens: 200,
      cache_read_input_tokens: 5000,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 50 },
    })
    const [row] = await db
      .select()
      .from(schema.claudeApiCalls)
      .where(eq(schema.claudeApiCalls.userId, student))
    assert.ok(row)
    assert.equal(row.inputTokens, 400)
    assert.equal(row.cacheReadTokens, 5000)
    assert.equal(row.cacheWriteTokens, 150, 'both cache-write lifetimes count')
    // Sonnet 5.5 at $2 / $10 / $0.2 / $2.5 / $4 per million tokens.
    assert.equal(row.estimatedCostUsd, '0.00425000')

    // 750 of 1000 tokens used (cache reads do not count): still allowed.
    await assertAiBudget(student)
    await call(student, { input_tokens: 200, output_tokens: 50 })
    await assert.rejects(assertAiBudget(student), (e: { status?: number }) => e.status === 429)
    await assertAiBudget(other)

    // A failed call is logged without usage and does not use the budget.
    await recordClaudeCall({
      userId: other,
      operation: 'tutor',
      model: 'claude-sonnet-5-5',
      request: {},
      status: 'failed',
      error: 'x'.repeat(3000),
    })
    const [failed] = await db
      .select()
      .from(schema.claudeApiCalls)
      .where(eq(schema.claudeApiCalls.userId, other))
    assert.equal(failed?.status, 'failed')
    assert.equal(failed?.inputTokens, null)
    assert.equal(failed?.error?.length, 2000, 'long errors are cut')
    await assertAiBudget(other)
  },
)
