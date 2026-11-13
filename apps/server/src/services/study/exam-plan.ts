import type Anthropic from '@anthropic-ai/sdk'
import {
  ALL_WEEKDAYS,
  type Confidence,
  type ExamPlan,
  type ExamPlanItem,
  type Locale,
  type PageType,
  daysBetween,
  notesLanguage,
  studyDates,
} from '@nc/shared'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../../db'
import { HttpError } from '../../http'
import { callTool, fromSchema } from '../ai-tool'
import { createMessage } from '../claude-client'
import { examPlanPrompt } from '../prompts'

import { MAX_PLAN_DAYS, toPlan } from './plans'

/** Exam prep: one Claude call proposes a plan; the dates, page links and checks are made here. */

const MAX_PLAN_PAGES = 80

export interface PlanPage {
  id: string
  title: string
  type: PageType
  lectureNumber: number | null
  /** Its section headings, so the plan can say what to focus on. */
  sections: string[]
  /** How well the student says they know it, if they said. */
  confidence?: Confidence | null
}

/**
 * The course's pages in course order, with their headings. With `scope`, only those pages (the exam's scope),
 * with the confidence given for each.
 */
export async function planPages(
  courseId: string,
  scope?: { id: string; confidence?: Confidence | null }[],
): Promise<PlanPage[]> {
  const rows = await db
    .select({
      id: schema.pages.id,
      title: schema.pages.title,
      type: schema.pages.type,
      lectureNumber: schema.pages.lectureNumber,
    })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.courseId, courseId),
        scope
          ? inArray(schema.pages.id, scope.length ? scope.map((s) => s.id) : [crypto.randomUUID()])
          : undefined,
      ),
    )
    .orderBy(sql`${schema.pages.lectureNumber} ASC NULLS LAST`, asc(schema.pages.sortOrder))
    .limit(MAX_PLAN_PAGES)
  if (!rows.length) return []
  const terms = await db
    .select({ pageId: schema.terms.pageId, text: schema.terms.text })
    .from(schema.terms)
    .where(
      inArray(
        schema.terms.pageId,
        rows.map((r) => r.id),
      ),
    )
  const confidence = new Map(scope?.map((s) => [s.id, s.confidence ?? null]))
  return rows.map((r) => ({
    ...r,
    confidence: confidence.get(r.id) ?? null,
    sections: terms
      .filter((t) => t.pageId === r.id)
      .map((t) => t.text)
      .slice(0, 8),
  }))
}

const CONFIDENCE_WORDS: Record<Confidence, string> = {
  know: 'knows it',
  shaky: 'shaky',
  new: 'new to them',
}

const planDraftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  days: z
    .array(
      z.object({
        day: z.number().int(),
        items: z
          .array(
            z.object({ ref: z.string().nullable().optional(), focus: z.string().trim().min(1).max(300) }),
          )
          .max(12),
      }),
    )
    .max(MAX_PLAN_DAYS * 2),
})
export type PlanDraft = z.infer<typeof planDraftSchema>

const planTool: Anthropic.Tool = {
  name: 'propose_revision_plan',
  description: 'Return the revision plan: what to study on each day before the exam.',
  input_schema: {
    type: 'object',
    required: ['title', 'days'],
    properties: {
      title: { type: 'string', description: 'Short plan title, e.g. "Orbital mechanics exam"' },
      days: {
        type: 'array',
        description: 'Study days in order. Leave out rest days.',
        items: {
          type: 'object',
          required: ['day', 'items'],
          properties: {
            day: { type: 'integer', description: 'Day number from the list, 1 = the first study day' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: ['focus'],
                properties: {
                  ref: {
                    type: ['string', 'null'],
                    description: 'The page to revise, by ref (e.g. "P3"); null for a task without a page',
                  },
                  focus: { type: 'string', description: 'What to do, in a few words' },
                },
              },
            },
          },
        },
      },
    },
  },
}

/**
 * Turn Claude's draft into plan days: day numbers become the study dates they stand for (day 1 = `dates[0]`),
 * refs become page links (an unknown ref keeps its task without a page), and days outside the plan are dropped.
 * Days stay in order and a day named twice is merged.
 */
export function planDays(draft: PlanDraft, pages: PlanPage[], dates: string[]) {
  const studyDays = dates.length
  const byDay = new Map<number, ExamPlanItem[]>()
  for (const { day, items } of draft.days) {
    if (day < 1 || day > studyDays || !items.length) continue
    const list = byDay.get(day) ?? []
    for (const { ref, focus } of items) {
      const page = ref && /^P\d+$/.test(ref) ? pages[Number(ref.slice(1)) - 1] : undefined
      list.push({
        id: crypto.randomUUID(),
        pageId: page?.id ?? null,
        pageTitle: page?.title ?? null,
        focus,
        done: false,
      })
    }
    byDay.set(day, list)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, items]) => ({ date: dates[day - 1] as string, items }))
}

/**
 * Propose a revision plan from today until the day before the exam, over the course's pages, in one Claude
 * call, and save it. The dates, links and checks are made here.
 */
export async function generateExamPlan(
  opts: {
    userId: string
    courseId: string
    courseName: string
    examDate: string
    today: string
    minutesPerDay: number
    /** Weekdays to study on (0 = Sunday); all days when left out. */
    weekdays?: number[]
    /** The exam's scope: these pages only, with how well each is known. All pages when left out. */
    pages?: { id: string; confidence?: Confidence | null }[]
    note?: string
    locale?: Locale
  },
  create: typeof createMessage = createMessage,
): Promise<ExamPlan> {
  const daysLeft = daysBetween(opts.today, opts.examDate)
  if (daysLeft < 1 || daysLeft > MAX_PLAN_DAYS)
    throw new HttpError(400, `The exam must be between tomorrow and ${MAX_PLAN_DAYS} days from today.`)
  const weekdays = opts.weekdays?.length ? [...new Set(opts.weekdays)].sort() : ALL_WEEKDAYS
  const dates = studyDates(opts.today, opts.examDate, weekdays)
  if (!dates.length) throw new HttpError(400, 'No study day is left before the exam on the chosen weekdays.')
  const pages = await planPages(opts.courseId, opts.pages)
  if (!pages.length)
    throw new HttpError(
      400,
      opts.pages
        ? 'Choose at least one page of the course.'
        : 'This course has no pages to plan a revision over yet.',
    )
  const list = pages
    .map((p, i) => {
      const lecture = p.lectureNumber !== null ? `, lecture ${p.lectureNumber}` : ''
      const sections = p.sections.length ? `: ${p.sections.join('; ')}` : ''
      const known = p.confidence ? `, student: ${CONFIDENCE_WORDS[p.confidence]}` : ''
      return `P${i + 1}: "${p.title}" (${p.type}${lecture}${known})${sections}`
    })
    .join('\n')
  const calendar = dates
    .map((date, i) => {
      const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'short',
        timeZone: 'UTC',
      })
      return `Day ${i + 1}: ${weekday} ${date}`
    })
    .join('\n')
  const language = notesLanguage(
    `${pages.map((p) => `${p.title} ${p.sections.join(' ')}`).join(' ')} ${opts.note ?? ''}`,
    opts.locale,
  )
  const { value: plan, usage } = await callTool({
    feature: 'exam-plan',
    userId: opts.userId,
    create,
    tool: planTool,
    prompt: examPlanPrompt({
      courseName: opts.courseName,
      examDate: opts.examDate,
      minutesPerDay: opts.minutesPerDay,
      language,
      calendar,
      pages: list,
      note: opts.note,
    }),
    parse: fromSchema(planDraftSchema),
    messages: {
      cutOff: 'The plan was cut off at the AI output limit. Try a later start or fewer days.',
      invalid: 'The AI returned an invalid plan. Try again.',
    },
  })
  const days = planDays(plan, pages, dates)
  if (!days.length) throw new HttpError(502, 'The AI returned an empty plan. Try again.')
  const [row] = await db
    .insert(schema.examPlans)
    .values({
      userId: opts.userId,
      courseId: opts.courseId,
      title: plan.title,
      examDate: opts.examDate,
      studyWeekdays: weekdays,
      days,
      usage,
    })
    .returning()
  if (!row) throw new Error('exam plan insert failed')
  return toPlan(row)
}
