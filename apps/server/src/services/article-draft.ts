import type Anthropic from '@anthropic-ai/sdk'
import { inlineContent, tidyLatex } from '@nc/shared'
import { z } from 'zod'
import { HttpError } from '../http'
import { invalidAnswer } from './ai-tool'
import { createMessage, modelFor } from './claude-client'
import { articleDraftPrompt } from './prompts'

const articleDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  blocks: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('heading'), text: z.string().trim().min(1).max(1000) }),
        z.object({ type: z.literal('paragraph'), text: z.string().trim().min(1).max(10_000) }),
        z.object({
          type: z.literal('formula'),
          latex: z.string().trim().min(1).max(2000),
          label: z.string().trim().max(100).nullable().optional(),
          description: z.string().trim().max(500).nullable().optional(),
        }),
      ]),
    )
    .min(1)
    .max(100),
})

export function parseArticleDraftResponse(response: {
  stop_reason: string | null
  content: Array<{ type: string; input?: unknown }>
}) {
  if (response.stop_reason === 'max_tokens')
    throw new HttpError(502, 'The article draft exceeded the AI output limit. Try generating it again.')
  const block = response.content.find((item) => item.type === 'tool_use')
  if (!block || block.type !== 'tool_use') throw new HttpError(502, 'The AI did not return an article draft')

  const parsed = articleDraftSchema.safeParse(block.input)
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 3)
      .map(({ code, path }) => `${path.join('.') || 'draft'} (${code})`)
      .join(', ')
    invalidAnswer(
      '[article-draft] Invalid response shape:',
      parsed.error,
      `The AI returned an invalid article draft: ${details}`,
    )
  }

  return {
    title: parsed.data.title,
    tags: parsed.data.tags,
    content: {
      type: 'doc' as const,
      content: parsed.data.blocks.map((item) => {
        if (item.type === 'formula')
          return {
            type: 'formula',
            attrs: {
              latex: tidyLatex(item.latex),
              label: item.label || null,
              description: item.description || null,
              pinned: false,
            },
          }
        if (item.type === 'heading')
          return {
            type: 'heading',
            attrs: { level: 2 },
            content: inlineContent(item.text),
          }
        // Inline $…$ becomes math, not dollar signs on the page.
        return { type: 'paragraph', content: inlineContent(item.text, { markdown: true }) }
      }),
    },
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
