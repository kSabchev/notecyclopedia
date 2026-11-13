import type Anthropic from '@anthropic-ai/sdk'
import {
  type CalculatorSpec,
  calculatorSpecSchema,
  defaultInputs,
  evaluateCalculator,
  issuesText,
} from '@nc/shared'
import { HttpError } from '../http'
import { type UsageMeter, createMessage, modelFor } from './claude-client'
import { calculatorSpecPrompt } from './prompts'

/** Calculators made by Claude from a description or a solved problem, checked and test-run before they are kept. */

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
  if (!parsed.success) return { error: issuesText(parsed.error, Number.POSITIVE_INFINITY) }
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
