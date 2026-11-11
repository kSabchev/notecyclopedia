import { z } from 'zod'
import type { ExamPlan, ExamPlanDay } from './types'

// A revision plan as a file, for export and import, and as the copy sent when a plan is shared. Page links travel
// as id and title: on import a task is linked to the page with that id in the target course, else to the page with
// the same title, else it stays a task without a page (keeping the title, so it is still clear what to read).

export const PLAN_FILE_FORMAT = 'notecyclopedia-exam-plan'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const planFileSchema = z.object({
  format: z.literal(PLAN_FILE_FORMAT),
  version: z.literal(1),
  title: z.string().trim().min(1).max(120),
  examDate: date,
  studyWeekdays: z.array(z.number().int().min(0).max(6)).max(7).default([0, 1, 2, 3, 4, 5, 6]),
  /** The course it was made for, for reference only. */
  courseName: z.string().max(200).optional(),
  days: z
    .array(
      z.object({
        date,
        items: z
          .array(
            z.object({
              focus: z.string().trim().min(1).max(300),
              done: z.boolean().default(false),
              /** The lecture it is about (calculators are personal and not in the file). */
              lectureNumber: z.number().int().positive().max(2_147_483_647).nullable().optional(),
              page: z
                .object({ id: z.string().max(100), title: z.string().max(200) })
                .nullable()
                .default(null),
            }),
          )
          .max(30),
      }),
    )
    .max(400),
})
export type PlanFile = z.infer<typeof planFileSchema>

/** The plan as a file; progress is kept, and the receiver decides whether to keep it. */
export function toPlanFile(plan: ExamPlan, courseName?: string): PlanFile {
  return {
    format: PLAN_FILE_FORMAT,
    version: 1,
    title: plan.title,
    examDate: plan.examDate,
    studyWeekdays: plan.studyWeekdays,
    courseName,
    days: plan.days.map((d) => ({
      date: d.date,
      items: d.items.map((i) => ({
        focus: i.focus,
        done: i.done,
        ...(i.lectureNumber != null && { lectureNumber: i.lectureNumber }),
        page: i.pageTitle ? { id: i.pageId ?? '', title: i.pageTitle } : null,
      })),
    })),
  }
}

/**
 * The days of an imported plan, with its tasks linked to the target course's pages: by id, else by title (ignoring
 * case and spacing). New ids are given to every task; progress is reset unless `keepProgress`.
 */
export function importPlanDays(
  file: PlanFile,
  pages: { id: string; title: string }[],
  keepProgress = false,
): { days: ExamPlanDay[]; linked: number; unlinked: number } {
  const key = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase()
  const byId = new Map(pages.map((p) => [p.id, p]))
  const byTitle = new Map(pages.map((p) => [key(p.title), p]))
  let linked = 0
  let unlinked = 0
  const days = [...file.days]
    .filter((d) => d.items.length)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      items: d.items.map((i) => {
        const page = i.page ? (byId.get(i.page.id) ?? byTitle.get(key(i.page.title))) : undefined
        if (i.page) {
          if (page) linked++
          else unlinked++
        }
        return {
          id: crypto.randomUUID(),
          pageId: page?.id ?? null,
          pageTitle: page?.title ?? i.page?.title ?? null,
          focus: i.focus,
          done: keepProgress && i.done,
          ...(i.lectureNumber != null && { lectureNumber: i.lectureNumber }),
        }
      }),
    }))
  return { days, linked, unlinked }
}
