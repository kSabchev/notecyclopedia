import type { CalculatorSpec } from './calculator'

/**
 * Widgets are interactive blocks inside a page. Each one stores a copy of the calculator spec it was
 * made from, so it works for every reader of the page (even when the library calculator is personal),
 * survives backups, and is visible to search and the AI. `sourceCalculatorId` links back to the
 * library calculator so editors can pull in later changes.
 *
 * This module has no runtime dependencies; validation and sampling live in `widget-runtime.ts`.
 */
export interface PlotConfig {
  /** Input swept along the x-axis. */
  x: string
  /** Outputs drawn as lines; outputs with different units are drawn as separate charts. */
  y: string[]
  from: number
  to: number
  samples?: number
}

export type WidgetAttrs =
  | { kind: 'calculator'; spec: CalculatorSpec; sourceCalculatorId: string | null }
  | { kind: 'plot'; spec: CalculatorSpec; sourceCalculatorId: string | null; plot: PlotConfig }

export type WidgetKind = WidgetAttrs['kind']

const withUnit = (label: string, unit?: string) => (unit ? `${label} [${unit}]` : label)

/** A plain-text description of a widget for search, AI context and revision diffs. */
export function describeWidget(attrs: Record<string, unknown> | undefined): string {
  const spec = attrs?.spec as CalculatorSpec | undefined
  if (!spec?.inputs || !spec.outputs) return 'Widget'
  if (attrs?.kind === 'plot') {
    const plot = attrs.plot as PlotConfig | undefined
    const x = spec.inputs.find((i) => i.key === plot?.x)
    const ys = spec.outputs.filter((o) => plot?.y.includes(o.key))
    if (plot && x && ys.length)
      return `Plot of ${ys.map((o) => withUnit(o.label, o.unit)).join(', ')} against ${withUnit(x.label, x.unit)} from ${plot.from} to ${plot.to} (calculator "${spec.name}")`
  }
  const inputs = spec.inputs.map((i) => withUnit(i.label, i.unit)).join(', ')
  const outputs = spec.outputs.map((o) => `${withUnit(o.label, o.unit)} = ${o.expr}`).join('; ')
  return `Calculator "${spec.name}". Inputs: ${inputs}. Outputs: ${outputs}`
}
