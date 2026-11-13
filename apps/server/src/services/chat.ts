import type Anthropic from '@anthropic-ai/sdk'
import type { AiAttachment, AiMode, WidgetAttrs } from '@nc/shared'
import { type UsageMeter, modelFor, streamText } from './claude-client'
import { chatSystemPrompt } from './prompts'
import type { RetrievedChunk } from './retrieval'

import { CHAT_TOOLS, type CalculatorLibrary, runChatTool } from './chat-tools'
import { withoutImages } from './claude-client'

/** The AI portal’s answers: the history sent to Claude, sources, photos, streaming and tool rounds. */

function sourcesBlock(sources: RetrievedChunk[]): string {
  const src = sources.length
    ? sources
        .map((s, i) => `<source n="${i + 1}" title="${s.title.replace(/"/g, "'")}">\n${s.text}\n</source>`)
        .join('\n')
    : '(no matching notes were found)'
  return `<sources>\n${src}\n</sources>`
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string; attachments?: AiAttachment[] }

/** What a photo counts for in the history budget: about the tokens of a downscaled image. */
const IMAGE_CHARS = 6_000

/**
 * The most recent turns that fit the budget, oldest first. Empty turns (e.g. an answer that failed
 * before any text arrived) are dropped because the API rejects empty content, and the result
 * starts with a user turn as the API requires.
 */
export function boundHistory(turns: ChatTurn[], maxChars = 60_000, maxTurns = 20): ChatTurn[] {
  const kept: ChatTurn[] = []
  let chars = 0
  for (let i = turns.length - 1; i >= 0 && kept.length < maxTurns; i--) {
    const turn = turns[i] as ChatTurn
    const images = turn.attachments?.length ?? 0
    if (!turn.content.trim() && !images) continue
    const size = turn.content.length + images * IMAGE_CHARS
    if (chars + size > maxChars) break
    chars += size
    kept.unshift(turn)
  }
  while (kept[0]?.role === 'assistant') kept.shift()
  return kept
}

/** A turn's photos (first, as the API recommends) and text as content blocks. */
function turnBlocks(turn: ChatTurn): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = (turn.attachments ?? []).map((a) => ({
    type: 'image',
    source: { type: 'base64', media_type: a.mediaType, data: a.data },
  }))
  if (turn.content.trim()) blocks.push({ type: 'text', text: turn.content })
  return blocks
}

/**
 * Stream an answer to the last turn of `history`. Earlier turns are sent without their sources, so the
 * conversation prefix stays identical between requests and is served from the prompt cache.
 */
export async function* streamAnswer(opts: {
  mode: AiMode
  history: ChatTurn[]
  sources: RetrievedChunk[]
  userId: string
  calculators: CalculatorLibrary
  meter?: UsageMeter
  /** Replaced in tests; Claude is never called from them. */
  stream?: typeof streamText
}): AsyncGenerator<AnswerEvent> {
  const { mode, history, sources, userId, calculators, meter, stream: streamFn = streamText } = opts
  const question = history.at(-1)
  if (question?.role !== 'user') throw new Error('The last chat turn must be from the user')
  const earlier: Anthropic.MessageParam[] = boundHistory(history.slice(0, -1)).map((turn) => ({
    role: turn.role,
    content: turnBlocks(turn),
  }))
  const lastBlocks = earlier.at(-1)?.content as Anthropic.ContentBlockParam[] | undefined
  const lastBlock = lastBlocks?.at(-1)
  if (lastBlocks && (lastBlock?.type === 'text' || lastBlock?.type === 'image'))
    lastBlocks[lastBlocks.length - 1] = { ...lastBlock, cache_control: { type: 'ephemeral' } }
  const asked: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: sourcesBlock(sources) },
    ...turnBlocks(question),
  ]
  // A second breakpoint after the question: tool rounds (find, then run a calculator) re-read the
  // sources and photos from the cache instead of paying for them again.
  const end = asked.at(-1)
  if (end?.type === 'text' || end?.type === 'image')
    asked[asked.length - 1] = { ...end, cache_control: { type: 'ephemeral' } }
  const messages: Anthropic.MessageParam[] = [...earlier, { role: 'user', content: asked }]
  // Claude may call tools (show an orbit, find and run calculators) and then continue its answer.
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model: modelFor(mode),
      max_tokens: 16000,
      system: chatSystemPrompt(mode),
      tools: CHAT_TOOLS,
      messages,
    }
    const stream = streamFn(request, {
      operation: 'chat',
      userId,
      meter,
      logRequest: withoutImages(request),
    })
    let step = await stream.next()
    try {
      while (!step.done) {
        yield { text: step.value }
        step = await stream.next()
      }
    } finally {
      // When the reader stops early (the browser went away), close the Claude stream too, so Claude stops
      // writing (and charging for) an answer nobody reads.
      if (!step.done) await stream.return(undefined as never)
    }
    const final = step.value
    if (final.stop_reason !== 'tool_use') return
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const block of final.content) {
      if (block.type !== 'tool_use') continue
      const outcome = await runChatTool(block.name, block.input, calculators)
      if (outcome.widget) yield { widget: outcome.widget }
      results.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: outcome.content,
        ...(outcome.isError ? { is_error: true } : {}),
      })
    }
    // The assistant turn goes back unchanged, thinking blocks included, as the API requires.
    messages.push({ role: 'assistant', content: final.content }, { role: 'user', content: results })
  }
}

export type AnswerEvent = { text: string } | { widget: WidgetAttrs }

/** Finding and running a calculator takes two rounds, so leave room for a few of those. */
const MAX_TOOL_ROUNDS = 6

/** A short title for a new AI thread. */
export function threadTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || 'New session'
}
