import type Anthropic from '@anthropic-ai/sdk'
import {
  type CalculatorReview,
  type CalculatorSpec,
  type Locale,
  checkCalculator,
  notesLanguage,
} from '@nc/shared'
import { z } from 'zod'
import { callTool } from './ai-tool'
import { calculatorFromTool, calculatorInputSchema } from './calculator-generation'
import { UsageMeter, createMessage } from './claude-client'
import { calculatorReviewPrompt } from './prompts'

const reviewTool: Anthropic.Tool = {
  name: 'review_calculator',
  description:
    'Report the problems found in the calculator and, if anything should change, the complete corrected calculator.',
  input_schema: {
    type: 'object',
    required: ['findings'],
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['severity', 'message'],
          properties: {
            severity: {
              type: 'string',
              enum: ['error', 'warning', 'note'],
              description:
                'error: gives a wrong result; warning: likely wrong or misleading; note: a worthwhile improvement',
            },
            key: { type: 'string', description: 'The input or output key it concerns, if any' },
            message: { type: 'string', description: 'What is wrong and why, in one or two sentences' },
          },
        },
      },
      revised: {
        ...calculatorInputSchema,
        description: 'The complete corrected calculator. Omit it when nothing needs to change.',
      },
    },
  },
}

/** The words of a calculator (not its formulas), for telling its language. */
const calculatorText = (spec: CalculatorSpec) =>
  [
    spec.name,
    spec.description,
    spec.theory,
    ...spec.inputs.map((i) => i.label),
    ...spec.outputs.flatMap((o) => [o.label, o.explanation]),
  ]
    .filter(Boolean)
    .join(' ')

const findingsSchema = z
  .array(
    z.object({
      severity: z.enum(['error', 'warning', 'note']),
      key: z.string().max(64).optional(),
      message: z.string().trim().min(1).max(1500),
    }),
  )
  .max(40)

/**
 * Ask Claude to check a calculator: the physics or mathematics of each formula, units and conversions,
 * defaults, theory and step explanations. The automatic checks go with it, and a proposed correction is
 * validated and test-run (with one retry) before it is returned. Nothing is saved.
 */
export async function reviewCalculator(
  spec: CalculatorSpec,
  userId: string,
  /** The reader's interface language: the fallback when the calculator has too little text to tell. */
  locale: Locale = 'en',
  create: typeof createMessage = createMessage,
  /** Rework instead of review: what the student wants changed. */
  instructions?: string,
): Promise<CalculatorReview> {
  const meter = new UsageMeter()
  const language = notesLanguage(calculatorText(spec), locale)
  const data = JSON.stringify({ calculator: spec, automaticChecks: checkCalculator(spec) })
  const content = calculatorReviewPrompt({ language, data, instructions })
  const { value } = await callTool<Pick<CalculatorReview, 'findings' | 'revised'>>({
    feature: 'calculator-review',
    operation: instructions ? 'calculator-rework' : 'calculator-review',
    userId,
    create,
    meter,
    tool: reviewTool,
    maxTokens: 16000,
    prompt: content,
    parse: (raw) => {
      const input = (raw ?? {}) as { findings?: unknown; revised?: unknown }
      const findings = findingsSchema.safeParse(input.findings ?? [])
      if (!findings.success)
        return { error: 'findings: each needs a severity (error, warning or note) and a message' }
      let revised: CalculatorSpec | null = null
      if (input.revised) {
        const outcome = calculatorFromTool(input.revised)
        if ('error' in outcome) return { error: `revised: ${outcome.error}` }
        revised = outcome.spec
      }
      return { value: { findings: findings.data.map((f) => ({ ...f, key: f.key ?? null })), revised } }
    },
    messages: {
      cutOff: 'The review was cut off at the AI output limit. Try again.',
      invalid: 'The AI could not produce a valid review. Try again.',
    },
  })
  return {
    ...value,
    revisedChecks: value.revised ? checkCalculator(value.revised) : [],
    usage: meter.total(),
  }
}
