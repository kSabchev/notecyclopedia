import { z } from 'zod'
import { HttpError } from '../http'

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
    const issues = parsed.error.issues.map(({ code, path }) => ({ code, path }))
    console.error('[article-draft] Invalid response shape:', issues)
    const details = issues
      .slice(0, 3)
      .map(({ code, path }) => `${path.join('.') || 'draft'} (${code})`)
      .join(', ')
    throw new HttpError(502, `The AI returned an invalid article draft: ${details}`)
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
              latex: item.latex,
              label: item.label || null,
              description: item.description || null,
              pinned: false,
            },
          }
        if (item.type === 'heading')
          return {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: item.text }],
          }
        return { type: 'paragraph', content: [{ type: 'text', text: item.text }] }
      }),
    },
  }
}
