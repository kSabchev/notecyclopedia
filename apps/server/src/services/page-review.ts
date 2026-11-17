import type Anthropic from '@anthropic-ai/sdk'
import {
  type DocBlock,
  type DocJSON,
  REVIEW_MAX_TOKENS,
  replaceParts,
  reviewParts,
  reviewTokens,
  tidyDoc,
} from '@nc/shared'
import { z } from 'zod'
import { HttpError } from '../http'
import { callTool, invalidAnswer } from './ai-tool'
import { pageReviewPrompt } from './prompts'

interface ReviewNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: ReviewNode[]
}

const reviewNodeSchema: z.ZodType<{
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: ReviewNode[]
}> = z.lazy(() =>
  z.object({
    type: z.enum([
      'text',
      'paragraph',
      'heading',
      'formula',
      'mathInline',
      'widget',
      'image',
      'callout',
      'bulletList',
      'orderedList',
      'listItem',
      'blockquote',
      'codeBlock',
      'horizontalRule',
      'hardBreak',
    ]),
    text: z.string().max(10_000).optional(),
    attrs: z.record(z.unknown()).optional(),
    marks: z
      .array(
        z.object({
          type: z.enum(['bold', 'italic', 'strike', 'code', 'link']),
          attrs: z.record(z.unknown()).optional(),
        }),
      )
      .max(20)
      .optional(),
    content: z.array(reviewNodeSchema).max(500).optional(),
  }),
)

const reviewDraftSchema = z.object({
  findings: z.array(z.string().trim().min(1).max(1000)).max(30),
  content: z.string().max(250_000),
})

const reviewPageTool: Anthropic.Tool = {
  name: 'review_page',
  description: 'Return review notes and the complete revised TipTap document as a JSON string.',
  input_schema: {
    type: 'object',
    required: ['findings', 'content'],
    properties: {
      findings: {
        type: 'array',
        items: { type: 'string', description: 'A factual concern or point that needs verification' },
      },
      content: {
        type: 'string',
        description:
          'A JSON-encoded TipTap document object with type "doc" and its complete content tree. Preserve the supported node and mark structures.',
      },
    },
  },
}

function validateDocument(content: ReviewNode[]) {
  const blockNodes = new Set([
    'paragraph',
    'heading',
    'formula',
    'widget',
    'image',
    'callout',
    'bulletList',
    'orderedList',
    'blockquote',
    'codeBlock',
    'horizontalRule',
  ])
  const allowedChildren: Record<string, Set<string>> = {
    doc: blockNodes,
    paragraph: new Set(['text', 'hardBreak', 'mathInline']),
    heading: new Set(['text', 'hardBreak', 'mathInline']),
    codeBlock: new Set(['text', 'hardBreak']),
    callout: new Set(['paragraph']),
    bulletList: new Set(['listItem']),
    orderedList: new Set(['listItem']),
    listItem: blockNodes,
    blockquote: blockNodes,
  }
  let nodeCount = 0
  let textLength = 0
  const visit = (node: ReviewNode, parent: string, depth: number) => {
    nodeCount += 1
    textLength += node.text?.length ?? 0
    if (depth > 30 || nodeCount > 3000 || textLength > 60_000)
      throw new HttpError(502, 'The AI returned a page draft that exceeds the document limits.')
    const children = node.content ?? []
    if (!allowedChildren[parent]?.has(node.type))
      throw new HttpError(502, 'The AI returned an invalid page draft.')
    if (
      ['text', 'formula', 'mathInline', 'widget', 'image', 'horizontalRule', 'hardBreak'].includes(
        node.type,
      ) &&
      children.length > 0
    )
      throw new HttpError(502, 'The AI returned an invalid page draft.')
    if (
      node.type === 'text' &&
      node.marks?.some((mark) => mark.type === 'link' && typeof mark.attrs?.href !== 'string')
    )
      throw new HttpError(502, 'The AI returned an invalid page draft.')
    if (node.marks?.length && node.type !== 'text')
      throw new HttpError(502, 'The AI returned an invalid page draft.')
    if (node.type === 'text' && (typeof node.text !== 'string' || children.length > 0))
      throw new HttpError(502, 'The AI returned an invalid page draft.')
    if (
      node.type === 'mathInline' &&
      (typeof node.attrs?.latex !== 'string' || node.attrs.latex.length > 2000)
    )
      throw new HttpError(502, 'The AI returned an invalid page draft.')
    if (node.type === 'heading' && ![2, 3].includes(Number(node.attrs?.level)))
      throw new HttpError(502, 'The AI returned an invalid page draft.')
    if (
      node.type === 'formula' &&
      (typeof node.attrs?.latex !== 'string' ||
        node.attrs.latex.length > 2000 ||
        (node.attrs.pinned !== undefined && typeof node.attrs.pinned !== 'boolean') ||
        (node.attrs.label !== undefined &&
          node.attrs.label !== null &&
          typeof node.attrs.label !== 'string') ||
        (node.attrs.description !== undefined &&
          node.attrs.description !== null &&
          typeof node.attrs.description !== 'string'))
    )
      throw new HttpError(502, 'The AI returned an invalid page draft.')
    if (
      ['doc', 'callout', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(node.type) &&
      children.length === 0
    )
      throw new HttpError(502, 'The AI returned an invalid page draft.')

    for (const child of children) visit(child, node.type, depth + 1)
  }
  if (!content.length) throw new HttpError(502, 'The AI returned an invalid page draft.')
  for (const node of content) visit(node, 'doc', 1)
}

export function parsePageReviewResponse(response: {
  stop_reason: string | null
  content: Array<{ type: string; input?: unknown }>
}) {
  if (response.stop_reason === 'max_tokens')
    throw new HttpError(502, 'This page is too long to review at once. Review it one section at a time.')
  const block = response.content.find((item) => item.type === 'tool_use')
  if (!block || block.type !== 'tool_use') throw new HttpError(502, 'The AI did not return a page review')
  return parsePageReviewInput(block.input)
}

/** The review tool's answer as findings and a checked, tidied page document; throws when it is invalid. */
export function parsePageReviewInput(input: unknown) {
  const parsed = reviewDraftSchema.safeParse(input)
  if (!parsed.success) {
    invalidAnswer(
      '[page-review] Invalid response shape:',
      parsed.error,
      'The AI returned an invalid page review. Try generating it again.',
    )
  }
  let content: unknown
  try {
    content = JSON.parse(parsed.data.content)
  } catch {
    throw new HttpError(502, 'The AI returned an invalid page draft. Try generating it again.')
  }
  const document = z
    .object({ type: z.literal('doc'), content: z.array(reviewNodeSchema).max(500) })
    .safeParse(content)
  if (!document.success) {
    invalidAnswer(
      '[page-review] Invalid document shape:',
      document.error,
      'The AI returned an invalid page draft. Try generating it again.',
    )
  }
  validateDocument(document.data.content)
  // Math the AI wrote as $…$ text becomes inline math, and formulas get the LaTeX tidy-up.
  return { findings: parsed.data.findings, content: tidyDoc(document.data as DocJSON).doc }
}

const TOO_LONG_PAGE = 'This page is too long to review at once. Review it one section at a time.'
const TOO_LONG_PART =
  'This section is too long to review at once. Choose a shorter one (a subsection) instead.'

/** One review call: the blocks given (a whole page, or part of one), revised. */
async function reviewBlocks(title: string, content: DocJSON, userId: string, sections?: string[]) {
  // The estimate is rough: refuse only what is well over the limit, and let the rest try.
  if (reviewTokens((content.content ?? []) as DocBlock[]) > REVIEW_MAX_TOKENS * 1.5)
    throw new HttpError(413, sections ? TOO_LONG_PART : TOO_LONG_PAGE)
  const { value } = await callTool<ReturnType<typeof parsePageReviewInput>>({
    feature: 'page-review',
    userId,
    tool: reviewPageTool,
    maxTokens: REVIEW_MAX_TOKENS,
    prompt: pageReviewPrompt({ title, content, sections }),
    // A revised page is too large to ask for twice.
    retries: 0,
    parse: (input) => {
      try {
        return { value: parsePageReviewInput(input) }
      } catch (e) {
        return { error: (e as Error).message }
      }
    },
    messages: {
      cutOff: sections ? TOO_LONG_PART : TOO_LONG_PAGE,
      invalid: 'The AI returned an invalid page review. Try generating it again.',
    },
  })
  return value
}

/**
 * Review a page, or the chosen sections of it (heading ids, or `INTRO_SECTION`). Sections are reviewed in as few
 * calls as fit (neighbours together), in parallel, and put back into the page, so the result is always the whole
 * page. A part that fails (too long, or an invalid answer) is reported in the findings while the others are kept; only
 * when every part fails is the error returned.
 */
export async function generatePageReview(
  title: string,
  content: unknown,
  userId: string,
  sectionIds?: string[],
) {
  const doc = content as DocJSON
  if (!sectionIds?.length) return { ...(await reviewBlocks(title, doc, userId)), sections: null }

  const { parts, missing } = reviewParts(doc, sectionIds)
  if (missing.length) throw new HttpError(404, 'A chosen section is no longer on the page.')
  const blocks = (doc.content ?? []) as DocBlock[]
  const results = await Promise.allSettled(
    parts.map((part) =>
      reviewBlocks(
        title,
        { type: 'doc', content: blocks.slice(part.start, part.end) },
        userId,
        part.sections.map((s) => s.title),
      ),
    ),
  )
  const label = (part: (typeof parts)[number]) =>
    part.sections.map((s) => (s.title ? `“${s.title}”` : 'the opening')).join(', ')
  const findings: string[] = []
  const revisions: { part: (typeof parts)[number]; blocks: DocBlock[] }[] = []
  results.forEach((r, i) => {
    const part = parts[i] as (typeof parts)[number]
    if (r.status === 'rejected') {
      findings.push(`Not reviewed: ${label(part)}. ${(r.reason as Error).message}`)
      return
    }
    revisions.push({ part, blocks: (r.value.content.content ?? []) as DocBlock[] })
    for (const f of r.value.findings) findings.push(parts.length > 1 ? `${label(part)}: ${f}` : f)
  })
  if (!revisions.length) throw (results[0] as PromiseRejectedResult).reason
  return {
    findings,
    content: replaceParts(doc, revisions),
    sections: revisions.flatMap((r) => r.part.sections),
  }
}
