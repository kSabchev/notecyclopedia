import type Anthropic from '@anthropic-ai/sdk'
import { type AiUsage, issuesText } from '@nc/shared'
import type { z } from 'zod'
import { HttpError } from '../http'
import { UsageMeter, createMessage, modelFor } from './claude-client'

/** What a tool's answer turned into: the value, or what was wrong with it (sent back to Claude on a retry). */
export type ToolOutcome<T> = { value: T } | { error: string }

/** A `parse` from a zod schema: the first few problems, by path, as the error. */
export function fromSchema<T>(schema: z.ZodType<T>): (input: unknown) => ToolOutcome<T> {
  return (input) => {
    const parsed = schema.safeParse(input)
    if (parsed.success) return { value: parsed.data }
    return { error: issuesText(parsed.error) }
  }
}

/**
 * An AI answer that failed its schema: logs where it was wrong (issue codes and paths, never the content, which may
 * hold the user's notes) and throws a 502 with `message`.
 */
export function invalidAnswer(
  log: string,
  error: { issues: { code: string; path: (string | number)[] }[] },
  message: string,
): never {
  console.error(
    log,
    error.issues.map(({ code, path }) => ({ code, path })),
  )
  throw new HttpError(502, message)
}

export interface ToolCallOptions<T> {
  /** The feature: picks its model (`ANTHROPIC_MODELS_JSON`) and names it in the usage log. */
  feature: string
  /** The usage-log name when it differs from the feature, e.g. 'calculator-rework'. */
  operation?: string
  userId: string
  tool: Anthropic.Tool
  prompt: string
  maxTokens?: number
  /** Check and shape the tool's input. An error is sent back once (see `retries`) so Claude can fix it. */
  parse: (input: unknown) => ToolOutcome<T>
  /** How often an invalid answer is sent back to be fixed (default 1; 0 for answers too large to repeat). */
  retries?: number
  /** Messages for the user. */
  messages?: {
    /** The answer hit the output limit. */
    cutOff?: string
    /** The answer stayed invalid (or there was no tool call). */
    invalid?: string
  }
  /** Shared with the caller to add the cost of further calls; a new one otherwise. */
  meter?: UsageMeter
  /** The Claude call; replaced in tests. */
  create?: typeof createMessage
}

/**
 * One AI feature call: Claude answers with a tool, the answer is checked by `parse`, an invalid answer is sent back
 * to be fixed (once by default), and the usage of every call is measured. Throws an HttpError (502) the user can act
 * on when the answer is cut off or stays invalid.
 */
export async function callTool<T>(opts: ToolCallOptions<T>): Promise<{ value: T; usage: AiUsage | null }> {
  const meter = opts.meter ?? new UsageMeter()
  const create = opts.create ?? createMessage
  const retries = opts.retries ?? 1
  const cutOff = opts.messages?.cutOff ?? 'The answer was cut off at the AI output limit. Try again.'
  const invalid = opts.messages?.invalid ?? 'The AI returned an invalid answer. Try again.'
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.prompt }]
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await create(
      {
        model: modelFor(opts.feature),
        max_tokens: opts.maxTokens ?? 8000,
        tools: [opts.tool],
        tool_choice: { type: 'auto' },
        messages,
      },
      { operation: opts.operation ?? opts.feature, userId: opts.userId, meter },
    )
    const call = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === opts.tool.name,
    )
    if (!call) throw new HttpError(502, res.stop_reason === 'max_tokens' ? cutOff : invalid)
    const outcome = opts.parse(call.input)
    if ('value' in outcome) return { value: outcome.value, usage: meter.total() }
    if (attempt === retries) throw new HttpError(502, res.stop_reason === 'max_tokens' ? cutOff : invalid)
    messages.push(
      { role: 'assistant', content: res.content },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: call.id,
            is_error: true,
            content: `Invalid ${opts.tool.name} answer: ${outcome.error}. Call ${opts.tool.name} again with the fix.`,
          },
        ],
      },
    )
  }
  throw new HttpError(502, invalid)
}
