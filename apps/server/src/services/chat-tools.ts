import type Anthropic from '@anthropic-ai/sdk'
import {
  CENTRAL_BODIES,
  type CalculatorSpec,
  MAX_ECCENTRICITY,
  type WidgetAttrs,
  calculationSteps,
  defaultInputs,
  evaluateCalculator,
  formatValue,
  issuesText,
  widgetAttrsSchema,
} from '@nc/shared'

/** The tools Claude may call in a chat: show an orbit, find the user’s calculators and run one. */

/** A saved calculator the user can use. */
export interface LibraryCalculator {
  id: string
  name: string
  spec: CalculatorSpec
}

/** The user's calculators, as the chat tools see them. */
export interface CalculatorLibrary {
  find(query: string): Promise<LibraryCalculator[]>
  get(id: string): Promise<LibraryCalculator | null>
}

export interface ToolOutcome {
  content: string
  isError?: boolean
  widget?: WidgetAttrs
}

/** Run one chat tool call. Errors are returned to Claude as text so it can retry or explain. */
export async function runChatTool(
  name: string,
  input: unknown,
  calculators: CalculatorLibrary,
): Promise<ToolOutcome> {
  if (name === 'show_orbit') {
    const orbit = orbitFromTool(input)
    if ('error' in orbit) return { content: orbit.error, isError: true }
    return {
      content:
        'The interactive diagram is now shown to the user, who can change the elements and animate it.',
      widget: orbit.widget,
    }
  }
  if (name === 'find_calculators') {
    const query = String((input as { query?: unknown } | null)?.query ?? '').trim()
    const found = query ? await calculators.find(query) : []
    if (!found.length)
      return {
        content:
          'No saved calculator matches. Calculate carefully yourself, or suggest that the user builds a calculator for this.',
      }
    return { content: JSON.stringify(found.map(describeForTool)) }
  }
  if (name === 'run_calculator') return runCalculatorTool(input, calculators)
  return { content: `Unknown tool ${name}`, isError: true }
}

/** What Claude needs to call run_calculator: the keys, units and defaults of the inputs, and the outputs. */
function describeForTool(calc: LibraryCalculator) {
  const { spec } = calc
  return {
    calculatorId: calc.id,
    name: spec.name,
    description: spec.description,
    inputs: spec.inputs.map((i) => ({ key: i.key, label: i.label, unit: i.unit, default: i.default })),
    outputs: spec.outputs.map((o) => ({ key: o.key, label: o.label, unit: o.unit })),
  }
}

async function runCalculatorTool(input: unknown, calculators: CalculatorLibrary): Promise<ToolOutcome> {
  const { calculatorId, inputs } = (input ?? {}) as {
    calculatorId?: unknown
    inputs?: { key?: unknown; value?: unknown }[]
  }
  const calc = typeof calculatorId === 'string' ? await calculators.get(calculatorId) : null
  if (!calc) return { content: 'Unknown calculatorId. Use one returned by find_calculators.', isError: true }
  const { spec } = calc
  const given = new Map<string, number>()
  for (const item of Array.isArray(inputs) ? inputs : []) {
    const key = String(item?.key ?? '')
    if (!spec.inputs.some((i) => i.key === key))
      return {
        content: `Unknown input "${key}". The inputs are: ${spec.inputs.map((i) => i.key).join(', ')}.`,
        isError: true,
      }
    if (typeof item.value !== 'number' || !Number.isFinite(item.value))
      return { content: `The value of "${key}" must be a finite number.`, isError: true }
    given.set(key, item.value)
  }
  const values = { ...defaultInputs(spec), ...Object.fromEntries(given) }
  const result = evaluateCalculator(spec, values)
  if (!result.ok) return { content: `The calculator failed: ${result.error}`, isError: true }

  const unit = (u?: string) => (u ? ` ${u}` : '')
  const defaulted = spec.inputs.filter((i) => !given.has(i.key))
  const lines = [
    `Calculator "${spec.name}" with ${spec.inputs.map((i) => `${i.key} = ${values[i.key]}${unit(i.unit)}`).join(', ')}.`,
    ...(defaulted.length ? [`Defaults were used for: ${defaulted.map((i) => i.key).join(', ')}.`] : []),
    'Steps:',
    ...calculationSteps(spec, values).map(
      (s) =>
        `${s.formula} = ${s.substituted ?? '?'} = ${s.value === null ? '?' : formatValue(s.value, spec.outputs.find((o) => o.key === s.key)?.precision ?? 3)}${unit(s.unit)}`,
    ),
    'Full-precision results (JSON):',
    JSON.stringify(result.values),
    'The user now sees this run and can change its inputs.',
  ]
  // The run is shown as a calculator block whose defaults are the values used.
  const shown: CalculatorSpec = {
    ...spec,
    inputs: spec.inputs.map((i) => ({ ...i, default: values[i.key] })),
  }
  return {
    content: lines.join('\n'),
    widget: { kind: 'calculator', spec: shown, sourceCalculatorId: calc.id },
  }
}

const findCalculatorsTool = {
  name: 'find_calculators',
  description:
    'Search the user\'s saved calculators by topic or quantity, e.g. "orbital period" or "vis-viva". Returns up to five matches with their calculatorId, input keys (with units and defaults) and outputs. Use it before run_calculator.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'A few keywords in the language of the calculators' },
    },
  },
} as Anthropic.Tool

const runCalculatorToolDef = {
  name: 'run_calculator',
  description:
    "Run one of the user's saved calculators and get every output with its step-by-step working. Give the values in the units the calculator expects (convert first if needed); inputs you leave out use the calculator's defaults. The user sees the run.",
  strict: true,
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['calculatorId', 'inputs'],
    properties: {
      calculatorId: { type: 'string', description: 'From find_calculators' },
      inputs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'value'],
          properties: {
            key: { type: 'string', description: 'Input key' },
            value: { type: 'number' },
          },
        },
      },
    },
  },
} as Anthropic.Tool

const showOrbitTool = {
  name: 'show_orbit',
  description:
    'Show the user an interactive diagram of a closed (elliptical) two-body orbit from its classical elements. Use it when seeing an orbit helps: a named orbit type (e.g. geostationary, Molniya, Tundra, GTO, Sun-synchronous), the effect of an element, or an orbit from a problem. The user can then change the elements, animate the motion and rotate the 3D view. Angles are in degrees. Call it once per orbit you want to show.',
  strict: true,
  // Small inputs, but stream them as they are generated; they are validated before use.
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['body', 'a', 'e', 'i', 'raan', 'argp', 'nu'],
    properties: {
      body: { type: 'string', enum: CENTRAL_BODIES.map((b) => b.key), description: 'Central body' },
      a: { type: 'number', description: 'Semi-major axis in km (from the body centre, not altitude)' },
      e: { type: 'number', description: `Eccentricity, 0 to ${MAX_ECCENTRICITY}` },
      i: { type: 'number', description: 'Inclination, 0 to 180°' },
      raan: { type: 'number', description: 'Right ascension of the ascending node Ω, 0 to 360°' },
      argp: { type: 'number', description: 'Argument of periapsis ω, 0 to 360°' },
      nu: { type: 'number', description: 'True anomaly ν, 0 to 360°' },
    },
  },
} as Anthropic.Tool

/** In a fixed order, so the tool definitions stay in the prompt cache. */
export const CHAT_TOOLS: Anthropic.Tool[] = [showOrbitTool, findCalculatorsTool, runCalculatorToolDef]

/** Validate a show_orbit call into an orbit widget, or explain what is wrong so Claude can retry. */
export function orbitFromTool(input: unknown): { widget: WidgetAttrs } | { error: string } {
  const { body, ...elements } = (input ?? {}) as Record<string, unknown>
  const parsed = widgetAttrsSchema.safeParse({ kind: 'orbit', body, elements })
  if (parsed.success) return { widget: parsed.data }
  return {
    error: `Invalid orbit: ${issuesText(parsed.error)}. Only closed orbits (e < 1) can be shown.`,
  }
}
