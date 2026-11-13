import type Anthropic from '@anthropic-ai/sdk'
import {
  type AiAttachment,
  type AiMode,
  CENTRAL_BODIES,
  type CalculatorSpec,
  MAX_ECCENTRICITY,
  type WidgetAttrs,
  calculationSteps,
  calculatorSpecSchema,
  defaultInputs,
  evaluateCalculator,
  formatValue,
  widgetAttrsSchema,
} from '@nc/shared'
import { HttpError } from '../http'
import { parseArticleDraftResponse } from './article-draft'
import { type UsageMeter, aiConfigured, createMessage, modelFor, streamText } from './claude-client'
import { articleDraftPrompt, calculatorSpecPrompt, chatSystemPrompt } from './prompts'
import type { RetrievedChunk } from './retrieval'

export { aiConfigured }

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

/** The request as stored in the usage log: photos are replaced by a note, so the log stays small. */
function withoutImages(request: Anthropic.MessageCreateParamsNonStreaming): Record<string, unknown> {
  return {
    ...request,
    messages: request.messages.map((m) =>
      typeof m.content === 'string'
        ? m
        : {
            ...m,
            content: m.content.map((b) =>
              b.type === 'image' && b.source.type === 'base64'
                ? { ...b, source: { ...b.source, data: '[image content omitted]' } }
                : b,
            ),
          },
    ),
  }
}

const articleDraftTool: Anthropic.Tool = {
  name: 'create_article_draft',
  description: 'Create an editable wiki article draft based only on the supplied source document.',
  input_schema: {
    type: 'object',
    required: ['title', 'tags', 'blocks'],
    properties: {
      title: { type: 'string', description: 'A concise article title' },
      tags: { type: 'array', items: { type: 'string' } },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['heading', 'paragraph', 'formula'] },
            text: { type: 'string', description: 'Text for a heading or paragraph block' },
            latex: { type: 'string', description: 'LaTeX for a formula block' },
            label: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
    },
  },
}

export async function generateArticleDraft(sourceName: string, sourceText: string, userId: string) {
  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: modelFor('article-draft'),
    max_tokens: 8192,
    tools: [articleDraftTool],
    tool_choice: { type: 'auto' },
    messages: [
      {
        role: 'user',
        content: articleDraftPrompt({ sourceName, sourceText }),
      },
    ],
  }
  const response = await createMessage(request, { operation: 'article-draft', userId })
  return parseArticleDraftResponse(response)
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

/** A saved calculator the user can use. */
export interface LibraryCalculator {
  id: string
  name: string
  spec: CalculatorSpec
}

/** The user's calculators, as the chat tools see them. */
export interface CalculatorLibrary {
  find(query: string): Promise<LibraryCalculator[]>
  get(id: string): Promise<LibraryCalculator | null>
}

export interface ToolOutcome {
  content: string
  isError?: boolean
  widget?: WidgetAttrs
}

/** Run one chat tool call. Errors are returned to Claude as text so it can retry or explain. */
export async function runChatTool(
  name: string,
  input: unknown,
  calculators: CalculatorLibrary,
): Promise<ToolOutcome> {
  if (name === 'show_orbit') {
    const orbit = orbitFromTool(input)
    if ('error' in orbit) return { content: orbit.error, isError: true }
    return {
      content:
        'The interactive diagram is now shown to the user, who can change the elements and animate it.',
      widget: orbit.widget,
    }
  }
  if (name === 'find_calculators') {
    const query = String((input as { query?: unknown } | null)?.query ?? '').trim()
    const found = query ? await calculators.find(query) : []
    if (!found.length)
      return {
        content:
          'No saved calculator matches. Calculate carefully yourself, or suggest that the user builds a calculator for this.',
      }
    return { content: JSON.stringify(found.map(describeForTool)) }
  }
  if (name === 'run_calculator') return runCalculatorTool(input, calculators)
  return { content: `Unknown tool ${name}`, isError: true }
}

/** What Claude needs to call run_calculator: the keys, units and defaults of the inputs, and the outputs. */
function describeForTool(calc: LibraryCalculator) {
  const { spec } = calc
  return {
    calculatorId: calc.id,
    name: spec.name,
    description: spec.description,
    inputs: spec.inputs.map((i) => ({ key: i.key, label: i.label, unit: i.unit, default: i.default })),
    outputs: spec.outputs.map((o) => ({ key: o.key, label: o.label, unit: o.unit })),
  }
}

async function runCalculatorTool(input: unknown, calculators: CalculatorLibrary): Promise<ToolOutcome> {
  const { calculatorId, inputs } = (input ?? {}) as {
    calculatorId?: unknown
    inputs?: { key?: unknown; value?: unknown }[]
  }
  const calc = typeof calculatorId === 'string' ? await calculators.get(calculatorId) : null
  if (!calc) return { content: 'Unknown calculatorId. Use one returned by find_calculators.', isError: true }
  const { spec } = calc
  const given = new Map<string, number>()
  for (const item of Array.isArray(inputs) ? inputs : []) {
    const key = String(item?.key ?? '')
    if (!spec.inputs.some((i) => i.key === key))
      return {
        content: `Unknown input "${key}". The inputs are: ${spec.inputs.map((i) => i.key).join(', ')}.`,
        isError: true,
      }
    if (typeof item.value !== 'number' || !Number.isFinite(item.value))
      return { content: `The value of "${key}" must be a finite number.`, isError: true }
    given.set(key, item.value)
  }
  const values = { ...defaultInputs(spec), ...Object.fromEntries(given) }
  const result = evaluateCalculator(spec, values)
  if (!result.ok) return { content: `The calculator failed: ${result.error}`, isError: true }

  const unit = (u?: string) => (u ? ` ${u}` : '')
  const defaulted = spec.inputs.filter((i) => !given.has(i.key))
  const lines = [
    `Calculator "${spec.name}" with ${spec.inputs.map((i) => `${i.key} = ${values[i.key]}${unit(i.unit)}`).join(', ')}.`,
    ...(defaulted.length ? [`Defaults were used for: ${defaulted.map((i) => i.key).join(', ')}.`] : []),
    'Steps:',
    ...calculationSteps(spec, values).map(
      (s) =>
        `${s.formula} = ${s.substituted ?? '?'} = ${s.value === null ? '?' : formatValue(s.value, spec.outputs.find((o) => o.key === s.key)?.precision ?? 3)}${unit(s.unit)}`,
    ),
    'Full-precision results (JSON):',
    JSON.stringify(result.values),
    'The user now sees this run and can change its inputs.',
  ]
  // The run is shown as a calculator block whose defaults are the values used.
  const shown: CalculatorSpec = {
    ...spec,
    inputs: spec.inputs.map((i) => ({ ...i, default: values[i.key] })),
  }
  return {
    content: lines.join('\n'),
    widget: { kind: 'calculator', spec: shown, sourceCalculatorId: calc.id },
  }
}

const findCalculatorsTool = {
  name: 'find_calculators',
  description:
    'Search the user\'s saved calculators by topic or quantity, e.g. "orbital period" or "vis-viva". Returns up to five matches with their calculatorId, input keys (with units and defaults) and outputs. Use it before run_calculator.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'A few keywords in the language of the calculators' },
    },
  },
} as Anthropic.Tool

const runCalculatorToolDef = {
  name: 'run_calculator',
  description:
    "Run one of the user's saved calculators and get every output with its step-by-step working. Give the values in the units the calculator expects (convert first if needed); inputs you leave out use the calculator's defaults. The user sees the run.",
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['calculatorId', 'inputs'],
    properties: {
      calculatorId: { type: 'string', description: 'From find_calculators' },
      inputs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'value'],
          properties: {
            key: { type: 'string', description: 'Input key' },
            value: { type: 'number' },
          },
        },
      },
    },
  },
} as Anthropic.Tool

const showOrbitTool = {
  name: 'show_orbit',
  description:
    'Show the user an interactive diagram of a closed (elliptical) two-body orbit from its classical elements. Use it when seeing an orbit helps: a named orbit type (e.g. geostationary, Molniya, Tundra, GTO, Sun-synchronous), the effect of an element, or an orbit from a problem. The user can then change the elements, animate the motion and rotate the 3D view. Angles are in degrees. Call it once per orbit you want to show.',
  strict: true,
  // Small inputs, but stream them as they are generated; they are validated before use.
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['body', 'a', 'e', 'i', 'raan', 'argp', 'nu'],
    properties: {
      body: { type: 'string', enum: CENTRAL_BODIES.map((b) => b.key), description: 'Central body' },
      a: { type: 'number', description: 'Semi-major axis in km (from the body centre, not altitude)' },
      e: { type: 'number', description: `Eccentricity, 0 to ${MAX_ECCENTRICITY}` },
      i: { type: 'number', description: 'Inclination, 0 to 180°' },
      raan: { type: 'number', description: 'Right ascension of the ascending node Ω, 0 to 360°' },
      argp: { type: 'number', description: 'Argument of periapsis ω, 0 to 360°' },
      nu: { type: 'number', description: 'True anomaly ν, 0 to 360°' },
    },
  },
} as Anthropic.Tool

/** In a fixed order, so the tool definitions stay in the prompt cache. */
const CHAT_TOOLS: Anthropic.Tool[] = [showOrbitTool, findCalculatorsTool, runCalculatorToolDef]

/** Validate a show_orbit call into an orbit widget, or explain what is wrong so Claude can retry. */
export function orbitFromTool(input: unknown): { widget: WidgetAttrs } | { error: string } {
  const { body, ...elements } = (input ?? {}) as Record<string, unknown>
  const parsed = widgetAttrsSchema.safeParse({ kind: 'orbit', body, elements })
  if (parsed.success) return { widget: parsed.data }
  return {
    error: `Invalid orbit: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}. Only closed orbits (e < 1) can be shown.`,
  }
}

/** A calculator as Claude writes it: used to save new calculators and to propose corrected ones. */
export const calculatorInputSchema = {
  type: 'object',
  required: ['name', 'inputs', 'outputs'],
  properties: {
    name: { type: 'string', description: 'Short name, in the language of the conversation' },
    description: { type: 'string' },
    theory: {
      type: 'string',
      description:
        'The theory behind the calculation, in the language of the conversation: the principle or law used, its assumptions and when it applies. One to three short paragraphs separated by blank lines.',
    },
    inputs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'label'],
        properties: {
          key: { type: 'string', description: 'Identifier: letters, digits, _' },
          label: { type: 'string' },
          unit: { type: 'string' },
          default: {
            type: 'number',
            description: 'A sensible example value, e.g. from the solved problem',
          },
          min: { type: 'number' },
          max: { type: 'number' },
        },
      },
    },
    outputs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'label', 'expr'],
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          unit: { type: 'string' },
          expr: {
            type: 'string',
            description:
              'math.js expression using input keys, constants and earlier output keys. Use ^ for powers, sqrt(), sin() etc. For an input in degrees write `sin(theta deg)`. Convert units explicitly (e.g. v_kmh / 3.6).',
          },
          precision: { type: 'integer' },
          explanation: {
            type: 'string',
            description: 'One sentence: what this step computes and why it is needed.',
          },
        },
      },
    },
    constants: { type: 'object', additionalProperties: { type: 'number' } },
    constantMetadata: {
      type: 'object',
      description:
        'For each constant: its name, symbol and unit (e.g. "km^3/s^2"). Units let the app check that the formulas give the units of their outputs.',
      additionalProperties: {
        type: 'object',
        required: ['name', 'symbol', 'unit'],
        properties: { name: { type: 'string' }, symbol: { type: 'string' }, unit: { type: 'string' } },
      },
    },
  },
} as const satisfies Anthropic.Tool.InputSchema

const calculatorTool: Anthropic.Tool = {
  name: 'save_calculator',
  description: 'Save a reusable calculator definition. Call it once per calculator.',
  input_schema: calculatorInputSchema,
}

/** Most calculators one request makes; a bigger request is better split into several. */
export const MAX_CALCULATORS = 6

/** Validate and test-run a save_calculator call: the spec, or what is wrong with it. */
export function calculatorFromTool(input: unknown): { spec: CalculatorSpec } | { error: string } {
  const parsed = calculatorSpecSchema.safeParse({ ...(input as object), version: 1 })
  if (!parsed.success)
    return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  const run = evaluateCalculator(parsed.data, defaultInputs(parsed.data))
  return run.ok ? { spec: parsed.data } : { error: run.error }
}

export interface GeneratedCalculators {
  calculators: CalculatorSpec[]
  /** Why calculators Claude attempted could not be made, when some succeeded. */
  failed: string[]
}

/**
 * Ask Claude for one or more calculators (one per independent calculation), then validate and test-run
 * each. Invalid ones go back to Claude with the error, twice at most; valid ones are kept.
 */
export async function generateCalculators(
  context: string,
  userId: string,
  meter?: UsageMeter,
  /** The Claude call; replaced in tests. */
  create: typeof createMessage = createMessage,
): Promise<GeneratedCalculators> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: calculatorSpecPrompt({ maxCalculators: MAX_CALCULATORS, context }),
    },
  ]
  const calculators: CalculatorSpec[] = []
  let errors: string[] = []
  for (let attempt = 0; attempt < 3; attempt++) {
    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model: modelFor('calculator-spec'),
      // Theory, explanations and thinking for several calculators need room; 2048 used to cut them off.
      max_tokens: 16000,
      tools: [calculatorTool],
      tool_choice: { type: 'auto' },
      messages,
    }
    const res = await create(request, { operation: 'calculator', userId, meter })
    const cutOff = res.stop_reason === 'max_tokens'
    const calls = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'save_calculator',
    )
    if (!calls.length) break
    const results: Anthropic.ContentBlockParam[] = []
    errors = []
    for (const call of calls) {
      const outcome: { spec: CalculatorSpec } | { error: string } =
        calculators.length >= MAX_CALCULATORS
          ? { error: `Not saved: at most ${MAX_CALCULATORS} calculators per request.` }
          : calculatorFromTool(call.input)
      if ('spec' in outcome) {
        // A fixed calculator sent again under the same name replaces the earlier one.
        const same = calculators.findIndex((c) => c.name === outcome.spec.name)
        if (same >= 0) calculators[same] = outcome.spec
        else calculators.push(outcome.spec)
        results.push({ type: 'tool_result', tool_use_id: call.id, content: `Saved "${outcome.spec.name}".` })
      } else {
        if (calculators.length < MAX_CALCULATORS) errors.push(outcome.error)
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          is_error: true,
          content: `Invalid calculator: ${outcome.error}. Call save_calculator again with the fixed calculator.`,
        })
      }
    }
    if (!errors.length) return { calculators, failed: [] }
    if (cutOff)
      results.push({
        type: 'text',
        text: 'Your reply was cut off at the output limit. Keep theory and explanations shorter.',
      })
    messages.push({ role: 'assistant', content: res.content }, { role: 'user', content: results })
  }
  if (calculators.length) return { calculators, failed: errors }
  throw new HttpError(
    502,
    errors.length
      ? `The AI could not produce a valid calculator: ${errors[0]}`
      : 'The AI did not return a calculator',
  )
}

/** Transcribe an image (whiteboard photo, scanned page) to text. Null when AI is not configured. */
export async function describeImage(buf: Buffer, mime: string, userId: string): Promise<string | null> {
  if (!aiConfigured()) return null
  const media = (
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/jpeg'
  ) as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: modelFor('image'),
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } },
          {
            type: 'text',
            text: 'Transcribe all text and formulas in this image (formulas in LaTeX). Then add one line describing any diagram. Output only the transcription.',
          },
        ],
      },
    ],
  }
  const logRequest = {
    ...request,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: '[image content omitted]' } },
          {
            type: 'text',
            text: 'Transcribe all text and formulas in this image (formulas in LaTeX). Then add one line describing any diagram. Output only the transcription.',
          },
        ],
      },
    ],
  }
  const res = await createMessage(request, { operation: 'image-transcription', userId, logRequest })
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n')
}

/** A short title for a new AI thread. */
export function threadTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || 'New session'
}
