import type Anthropic from '@anthropic-ai/sdk'
import { type Locale, type QuickCheck, notesLanguage } from '@nc/shared'
import { z } from 'zod'
import { callTool, fromSchema } from '../ai-tool'
import { createMessage } from '../claude-client'
import { quickCheckPrompt } from '../prompts'

/** Quick check: two or three questions about one answer, made only when asked. */

const quickCheckSchema = z.object({
  questions: z
    .array(
      z.object({ question: z.string().trim().min(1).max(1000), answer: z.string().trim().min(1).max(3000) }),
    )
    .min(1)
    .max(3),
})

const quickCheckTool: Anthropic.Tool = {
  name: 'quick_check',
  description: 'Return two or three short questions that check the explanation was understood, with answers.',
  input_schema: {
    type: 'object',
    required: ['questions'],
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['question', 'answer'],
          properties: {
            question: { type: 'string', description: 'Markdown; LaTeX in $…$' },
            answer: { type: 'string', description: 'A short model answer; Markdown, LaTeX in $…$' },
          },
        },
      },
    },
  },
}

/** Two or three questions about an explanation, answerable from it: understanding, not recall. */
export async function generateQuickCheck(
  asked: string,
  explanation: string,
  userId: string,
  locale: Locale = 'en',
  create: typeof createMessage = createMessage,
): Promise<QuickCheck> {
  const { value, usage } = await callTool({
    feature: 'quick-check',
    userId,
    create,
    tool: quickCheckTool,
    maxTokens: 2000,
    prompt: quickCheckPrompt({
      asked,
      explanation,
      language: notesLanguage(`${asked} ${explanation}`, locale),
    }),
    parse: fromSchema(quickCheckSchema),
    messages: { invalid: 'The AI returned invalid questions. Try again.' },
  })
  return { questions: value.questions, usage }
}
