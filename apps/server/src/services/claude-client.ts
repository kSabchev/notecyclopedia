import Anthropic from '@anthropic-ai/sdk'
import type { AiUsage } from '@nc/shared'
import { env } from '../env'
import { HttpError } from '../http'
import { type ClaudeUsage, assertAiBudget, estimateCost, recordClaudeCall } from './claude-usage'

const client = env.anthropicKey ? new Anthropic({ apiKey: env.anthropicKey }) : null

export const aiConfigured = () => client !== null

/** The model for an AI feature: its ANTHROPIC_MODELS_JSON override, else ANTHROPIC_MODEL. */
export function modelFor(feature: string): string {
  return env.anthropicModels[feature] ?? env.anthropicModel
}

/** Sums the usage of the Claude calls behind one answer, for showing its cost. */
export class UsageMeter {
  private usage: AiUsage = {
    models: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  }

  add(model: string, usage: ClaudeUsage) {
    const u = this.usage
    if (!u.models.includes(model)) u.models.push(model)
    u.inputTokens += usage.input_tokens
    u.outputTokens += usage.output_tokens
    u.cacheReadTokens += usage.cache_read_input_tokens ?? 0
    u.cacheWriteTokens +=
      (usage.cache_creation?.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0)
    const cost = estimateCost(model, usage)
    u.costUsd = cost === null || u.costUsd === null ? null : u.costUsd + Number(cost)
  }

  /** Null when no call was measured. */
  total(): AiUsage | null {
    return this.usage.models.length ? { ...this.usage, models: [...this.usage.models] } : null
  }
}

function requireClient(): Anthropic {
  if (!client) throw new HttpError(503, 'AI is not configured. Add ANTHROPIC_API_KEY to .env')
  return client
}

export interface ClaudeCallOptions {
  /** Name of the feature making the call, shown in the usage log. */
  operation: string
  userId: string
  /** Stored in the usage log instead of the request, e.g. with image bytes removed. */
  logRequest?: Record<string, unknown>
  /** Also counts the call here, e.g. to show the cost of an answer. */
  meter?: UsageMeter
}

/** Turn SDK errors into messages the user can act on; other errors pass through. */
function toHttpError(operation: string, error: unknown): unknown {
  if (error instanceof Anthropic.APIConnectionError) {
    console.error(`[${operation}] Could not connect to the Anthropic API:`, error.message)
    return new HttpError(
      502,
      'Could not connect to Claude. Check the server internet connection and try again.',
    )
  }
  if (error instanceof Anthropic.RateLimitError)
    return new HttpError(503, 'Claude is receiving too many requests right now. Try again in a minute.')
  if (error instanceof Anthropic.APIError) {
    console.error(`[${operation}] Claude API returned ${error.status}:`, error.message)
    return new HttpError(502, 'Claude could not complete the request. Check the server logs and try again.')
  }
  return error
}

/** One Claude request, checked against the user's daily budget and recorded in the usage log. */
export async function createMessage(
  request: Anthropic.MessageCreateParamsNonStreaming,
  opts: ClaudeCallOptions,
): Promise<Anthropic.Message> {
  const c = requireClient()
  await assertAiBudget(opts.userId)
  const logged = {
    userId: opts.userId,
    operation: opts.operation,
    request: opts.logRequest ?? { ...request },
  }
  let response: Anthropic.Message
  try {
    response = await c.messages.create(request)
  } catch (error) {
    await recordClaudeCall({
      ...logged,
      model: request.model,
      status: 'failed',
      error: (error as Error).message,
    })
    throw toHttpError(opts.operation, error)
  }
  await recordClaudeCall({ ...logged, model: response.model, status: 'succeeded', usage: response.usage })
  opts.meter?.add(response.model, response.usage)
  return response
}

/**
 * Stream a Claude response as text deltas, with the same budget check and logging as `createMessage`.
 * Returns the final message, e.g. to run the tools it asks for.
 */
export async function* streamText(
  request: Anthropic.MessageCreateParamsNonStreaming,
  opts: ClaudeCallOptions,
): AsyncGenerator<string, Anthropic.Message> {
  const c = requireClient()
  await assertAiBudget(opts.userId)
  const logged = {
    userId: opts.userId,
    operation: opts.operation,
    request: opts.logRequest ?? { ...request },
  }
  const stream = c.messages.stream(request)
  let completed = false
  try {
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield ev.delta.text
    }
    const response = await stream.finalMessage()
    completed = true
    await recordClaudeCall({ ...logged, model: response.model, status: 'succeeded', usage: response.usage })
    opts.meter?.add(response.model, response.usage)
    return response
  } catch (error) {
    completed = true
    await recordClaudeCall({
      ...logged,
      model: request.model,
      status: 'failed',
      error: (error as Error).message,
    })
    throw toHttpError(opts.operation, error)
  } finally {
    // The consumer stopped early (e.g. the browser disconnected).
    if (!completed) {
      stream.abort()
      await recordClaudeCall({
        ...logged,
        model: request.model,
        status: 'failed',
        error: 'Claude response stream ended before completion',
      })
    }
  }
}
