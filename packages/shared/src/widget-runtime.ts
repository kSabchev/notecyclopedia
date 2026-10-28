import { z } from 'zod'
import { type CalculatorSpec, calculatorSpecSchema, evaluateCalculator } from './calculator'
import type { DocJSON } from './types'
import type { PlotConfig } from './widget'

export const MAX_PLOT_SERIES = 4

const plotConfigSchema = z
  .object({
    x: z.string().min(1),
    y: z.array(z.string().min(1)).min(1).max(MAX_PLOT_SERIES),
    from: z.number().finite(),
    to: z.number().finite(),
    samples: z.number().int().min(10).max(500).optional(),
  })
  .refine((p) => p.from < p.to, { message: 'The plot range must start below where it ends', path: ['to'] })

const sourceCalculatorId = z.string().uuid().nullable().default(null)

export const widgetAttrsSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('calculator'), spec: calculatorSpecSchema, sourceCalculatorId }),
    z.object({
      kind: z.literal('plot'),
      spec: calculatorSpecSchema,
      sourceCalculatorId,
      plot: plotConfigSchema,
    }),
  ])
  .superRefine((w, ctx) => {
    if (w.kind !== 'plot') return
    if (!w.spec.inputs.some((i) => i.key === w.plot.x))
      ctx.addIssue({ code: 'custom', message: `Unknown input "${w.plot.x}"`, path: ['plot', 'x'] })
    for (const key of w.plot.y)
      if (!w.spec.outputs.some((o) => o.key === key))
        ctx.addIssue({ code: 'custom', message: `Unknown output "${key}"`, path: ['plot', 'y'] })
  })

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[] }

/** The first problem with a widget block in the document, or null when every widget is valid. */
export function invalidWidget(doc: DocJSON): string | null {
  const walk = (n: Node): string | null => {
    if (n.type === 'widget') {
      const parsed = widgetAttrsSchema.safeParse(n.attrs ?? {})
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        return `Invalid widget: ${issue ? `${issue.path.join('.')} ${issue.message}`.trim() : 'unknown error'}`
      }
    }
    for (const c of n.content ?? []) {
      const found = walk(c)
      if (found) return found
    }
    return null
  }
  for (const n of (doc.content ?? []) as Node[]) {
    const found = walk(n)
    if (found) return found
  }
  return null
}

/** A sensible sweep for an input: its min..max, or 0..2× its default. */
export function defaultPlotRange(spec: CalculatorSpec, inputKey: string): { from: number; to: number } {
  const input = spec.inputs.find((i) => i.key === inputKey)
  if (input?.min !== undefined && input.max !== undefined && input.min < input.max)
    return { from: input.min, to: input.max }
  const base = Math.abs(input?.default ?? 1) || 1
  return { from: input?.min ?? 0, to: Math.max((input?.min ?? 0) + base, base * 2) }
}

export interface PlotPoint {
  x: number
  /** One value per plotted output; null where the calculator cannot be evaluated (a gap in the line). */
  y: Record<string, number | null>
}

/** Evaluate the calculator across the plot range, holding the other inputs at `inputs`. */
export function samplePlot(
  spec: CalculatorSpec,
  plot: PlotConfig,
  inputs: Record<string, number>,
): PlotPoint[] {
  const n = plot.samples ?? 120
  const points: PlotPoint[] = []
  for (let i = 0; i < n; i++) {
    const x = plot.from + ((plot.to - plot.from) * i) / (n - 1)
    const result = evaluateCalculator(spec, { ...inputs, [plot.x]: x })
    points.push({
      x,
      y: Object.fromEntries(plot.y.map((key) => [key, result.ok ? (result.values[key] ?? null) : null])),
    })
  }
  return points
}
