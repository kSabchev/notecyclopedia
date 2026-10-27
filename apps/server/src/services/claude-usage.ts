import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { db, schema } from '../db'
import { env } from '../env'
import { HttpError, forbidden, me } from '../http'

export interface ClaudeUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null
    ephemeral_1h_input_tokens?: number | null
  } | null
}

let lastPrunedAt = 0

export function estimateCost(model: string, usage: ClaudeUsage): string | null {
  const match = Object.entries(env.anthropicPricing)
    .filter(([key]) => model === key || model.startsWith(`${key}-`))
    .sort(([a], [b]) => b.length - a.length)[0]?.[1]
  if (!match) return null

  const cache5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0
  const cache1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const dollars =
    (usage.input_tokens * match.input +
      usage.output_tokens * match.output +
      (usage.cache_read_input_tokens ?? 0) * (match.cacheRead ?? match.input) +
      cache5m * (match.cacheWrite5m ?? match.input) +
      cache1h * (match.cacheWrite1h ?? match.cacheWrite5m ?? match.input)) /
    1_000_000
  return dollars.toFixed(8)
}

export async function recordClaudeCall(input: {
  userId: string | null
  operation: string
  model: string
  request: Record<string, unknown>
  status: 'succeeded' | 'failed'
  usage?: ClaudeUsage
  error?: string
}) {
  try {
    const usage = input.usage
    await db.insert(schema.claudeApiCalls).values({
      userId: input.userId,
      operation: input.operation,
      model: input.model,
      request: input.request,
      status: input.status,
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
      cacheReadTokens: usage?.cache_read_input_tokens ?? null,
      cacheWriteTokens: usage
        ? (usage.cache_creation?.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0)
        : null,
      estimatedCostUsd: usage ? estimateCost(input.model, usage) : null,
      error: input.error?.slice(0, 2000) ?? null,
    })
    if (Date.now() - lastPrunedAt > 6 * 60 * 60 * 1000) {
      const cutoff = new Date(Date.now() - env.anthropicLogRetentionDays * 24 * 60 * 60 * 1000)
      await db.delete(schema.claudeApiCalls).where(lt(schema.claudeApiCalls.createdAt, cutoff))
      lastPrunedAt = Date.now()
    }
  } catch (error) {
    console.error('[claude-usage] Could not record API call:', error)
  }
}

/**
 * Throws 429 when the user has used their AI_DAILY_TOKEN_LIMIT in the last 24 hours. Input, output and
 * cache-write tokens count; cache reads are cheap and do not.
 */
export async function assertAiBudget(userId: string) {
  if (!env.aiDailyTokenLimit) return
  const t = schema.claudeApiCalls
  const [row] = await db
    .select({
      used: sql<string>`coalesce(sum(coalesce(${t.inputTokens}, 0) + coalesce(${t.outputTokens}, 0) + coalesce(${t.cacheWriteTokens}, 0)), 0)`,
    })
    .from(t)
    .where(and(eq(t.userId, userId), gte(t.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))))
  if (Number(row?.used ?? 0) >= env.aiDailyTokenLimit)
    throw new HttpError(429, 'You have reached your daily AI limit. Try again later.')
}

export function requireAdmin(email: string) {
  if (!env.adminEmails.has(email.trim().toLowerCase())) throw forbidden()
}

export const admin = Router()

admin.get('/access', (req, res) => {
  const user = me(req)
  res.json({ isAdmin: env.adminEmails.has(user.email.trim().toLowerCase()) })
})

admin.get('/claude-calls', async (req, res) => {
  const user = me(req)
  requireAdmin(user.email)
  const { limit, offset } = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
    })
    .parse(req.query)
  const rows = await db
    .select({
      id: schema.claudeApiCalls.id,
      userEmail: schema.user.email,
      operation: schema.claudeApiCalls.operation,
      model: schema.claudeApiCalls.model,
      request: schema.claudeApiCalls.request,
      status: schema.claudeApiCalls.status,
      inputTokens: schema.claudeApiCalls.inputTokens,
      outputTokens: schema.claudeApiCalls.outputTokens,
      cacheReadTokens: schema.claudeApiCalls.cacheReadTokens,
      cacheWriteTokens: schema.claudeApiCalls.cacheWriteTokens,
      estimatedCostUsd: schema.claudeApiCalls.estimatedCostUsd,
      error: schema.claudeApiCalls.error,
      createdAt: schema.claudeApiCalls.createdAt,
    })
    .from(schema.claudeApiCalls)
    .leftJoin(schema.user, eq(schema.user.id, schema.claudeApiCalls.userId))
    .orderBy(desc(schema.claudeApiCalls.createdAt))
    .limit(limit + 1)
    .offset(offset)
  res.json({ calls: rows.slice(0, limit), hasMore: rows.length > limit })
})
