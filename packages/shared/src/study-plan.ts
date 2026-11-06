import { addDays } from './dates'
import type { ExamPlanDay, ExamPlanItem } from './types'

// Rescheduling a revision plan, done in code (no AI): catching up on missed tasks, and keeping tasks before the
// exam when its date moves. Dates are YYYY-MM-DD; weekdays are 0 = Sunday … 6 = Saturday.

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()

/** The study dates from `from` up to the day before the exam, on the chosen weekdays. */
export function studyDates(from: string, examDate: string, weekdays: number[] = ALL_WEEKDAYS): string[] {
  const out: string[] = []
  const days = weekdays.length ? weekdays : ALL_WEEKDAYS
  for (let date = from; date < examDate && out.length < 400; date = addDays(date, 1))
    if (days.includes(weekdayOf(date))) out.push(date)
  return out
}

/**
 * Put tasks onto `dates`, each on the date with the fewest unfinished tasks so far (the earliest on a tie), in the
 * order given. Days left empty are dropped; days stay in date order.
 */
export function spreadTasks(days: ExamPlanDay[], tasks: ExamPlanItem[], dates: string[]): ExamPlanDay[] {
  const byDate = new Map(days.map((d) => [d.date, [...d.items]]))
  for (const date of dates) if (!byDate.has(date)) byDate.set(date, [])
  const load = (date: string) => (byDate.get(date) ?? []).filter((i) => !i.done).length
  for (const task of tasks) {
    let best = dates[0]
    for (const date of dates) if (best === undefined || load(date) < load(best)) best = date
    if (best === undefined) break
    byDate.get(best)?.push(task)
  }
  return [...byDate.entries()]
    .filter(([, items]) => items.length)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, items }))
}

/** Unfinished tasks on days before `today`. */
export const overdueTasks = (days: ExamPlanDay[], today: string) =>
  days.filter((d) => d.date < today).flatMap((d) => d.items.filter((i) => !i.done))

/** Tasks on the exam day or later, e.g. after the exam was moved earlier. */
export const tasksFromExamOn = (days: ExamPlanDay[], examDate: string) =>
  days.filter((d) => d.date >= examDate).flatMap((d) => d.items)

/**
 * Catch up: move the unfinished tasks of past days onto the study days left, from today until the day before the
 * exam. Done tasks stay where they were. Returns null when no study day is left.
 */
export function catchUp(
  days: ExamPlanDay[],
  today: string,
  examDate: string,
  weekdays: number[] = ALL_WEEKDAYS,
): ExamPlanDay[] | null {
  const dates = studyDates(today, examDate, weekdays)
  if (!dates.length) return null
  const late = new Set(overdueTasks(days, today).map((i) => i.id))
  const kept = days.map((d) => ({ ...d, items: d.items.filter((i) => !late.has(i.id)) }))
  return spreadTasks(kept, overdueTasks(days, today), dates)
}

/**
 * Keep the plan before the exam: tasks on the exam day or later move onto the study days left before it, from
 * `today`. Returns null when no study day is left.
 */
export function fitBeforeExam(
  days: ExamPlanDay[],
  today: string,
  examDate: string,
  weekdays: number[] = ALL_WEEKDAYS,
): ExamPlanDay[] | null {
  const moving = tasksFromExamOn(days, examDate)
  if (!moving.length) return days
  const dates = studyDates(today, examDate, weekdays)
  if (!dates.length) return null
  return spreadTasks(
    days.filter((d) => d.date < examDate),
    moving,
    dates,
  )
}
