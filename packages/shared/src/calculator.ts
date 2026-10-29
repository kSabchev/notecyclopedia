import { type MathNode, all, create } from 'mathjs'
import { z } from 'zod'

/**
 * A calculator is a small, portable definition: named inputs (with units for display),
 * and outputs given as math.js expressions over the inputs and earlier outputs.
 *
 * Angles: write `theta deg` in an expression to treat an input as degrees, e.g. `sin(theta deg)`.
 */

const key = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Use letters, digits and _ (start with a letter)')
  .max(32)

export const calculatorInputSchema = z.object({
  key,
  label: z.string().min(1).max(80),
  unit: z.string().max(24).optional(),
  default: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
})

export const calculatorOutputSchema = z.object({
  key,
  label: z.string().min(1).max(80),
  unit: z.string().max(24).optional(),
  expr: z.string().min(1).max(500),
  precision: z.number().int().min(0).max(12).optional(),
  /** Why this step is done, shown in the step-by-step solution. */
  explanation: z.string().max(1000).optional(),
})

const calculatorConstantMetadataSchema = z.object({
  name: z.string().min(1).max(120),
  symbol: z.string().min(1).max(32),
  unit: z.string().min(1).max(40),
})

export const calculatorSpecSchema = z
  .object({
    version: z.literal(1).default(1),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    /** The theory behind the calculation: paragraphs separated by blank lines. */
    theory: z.string().max(8000).optional(),
    inputs: z.array(calculatorInputSchema).min(1).max(30),
    outputs: z.array(calculatorOutputSchema).min(1).max(30),
    constants: z.record(key, z.number()).optional(),
    constantMetadata: z.record(key, calculatorConstantMetadataSchema).optional(),
  })
  .superRefine((spec, ctx) => {
    const keys = [...spec.inputs.map((input) => input.key), ...Object.keys(spec.constants ?? {})]
    const seen = new Set<string>()
    for (const key of keys) {
      if (seen.has(key)) ctx.addIssue({ code: 'custom', message: `Duplicate key "${key}"` })
      seen.add(key)
    }
    const known = new Set(seen)
    for (const [index, output] of spec.outputs.entries()) {
      if (seen.has(output.key))
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate key "${output.key}"`,
          path: ['outputs', index, 'key'],
        })
      seen.add(output.key)

      try {
        compileExpr(output.expr, 'py', known)
        compileExpr(output.expr, 'js', known)
      } catch (error) {
        ctx.addIssue({
          code: 'custom',
          message: (error as Error).message,
          path: ['outputs', index, 'expr'],
        })
      }
      known.add(output.key)
    }
  })

export type CalculatorInput = z.infer<typeof calculatorInputSchema>
export type CalculatorOutput = z.infer<typeof calculatorOutputSchema>
export type CalculatorSpec = z.infer<typeof calculatorSpecSchema>

// A restricted math.js instance: no import/createUnit/evaluate-inside-expressions.
const math = create(all as NonNullable<typeof all>)
const limitedEvaluate = math.evaluate
const limitedParse = math.parse
math.import(
  {
    import: () => {
      throw new Error('import is disabled')
    },
    createUnit: () => {
      throw new Error('createUnit is disabled')
    },
    evaluate: () => {
      throw new Error('evaluate is disabled')
    },
    parse: () => {
      throw new Error('parse is disabled')
    },
    simplify: () => {
      throw new Error('simplify is disabled')
    },
    derivative: () => {
      throw new Error('derivative is disabled')
    },
  },
  { override: true },
)

export type CalcResult =
  | { ok: true; values: Record<string, number> }
  | { ok: false; error: string; key?: string }

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (math.isUnit(v)) return (v as math.Unit).toNumber()
  if (math.isBigNumber(v) || math.isFraction(v)) return math.number(v as never) as number
  throw new Error('Expression did not produce a number')
}

/** Evaluate all outputs in order. Each output can use inputs, constants and earlier outputs. */
export function evaluateCalculator(spec: CalculatorSpec, inputs: Record<string, number>): CalcResult {
  const scope = new Map<string, unknown>()
  for (const [k, v] of Object.entries(spec.constants ?? {})) scope.set(k, v)
  for (const inp of spec.inputs) {
    const v = inputs[inp.key] ?? inp.default
    if (v === undefined || Number.isNaN(v))
      return { ok: false, error: `Missing value for ${inp.label}`, key: inp.key }
    scope.set(inp.key, v)
  }
  const values: Record<string, number> = {}
  for (const out of spec.outputs) {
    try {
      const n = toNumber(limitedEvaluate(out.expr, scope))
      if (!Number.isFinite(n)) return { ok: false, error: `${out.label} is not finite`, key: out.key }
      values[out.key] = n
      scope.set(out.key, n)
    } catch (e) {
      return { ok: false, error: `${out.label}: ${(e as Error).message}`, key: out.key }
    }
  }
  return { ok: true, values }
}

/** Default values for every input (falls back to 1). */
export function defaultInputs(spec: CalculatorSpec): Record<string, number> {
  return Object.fromEntries(spec.inputs.map((i) => [i.key, i.default ?? 1]))
}

export function formatValue(n: number, precision = 3): string {
  if (n !== 0 && (Math.abs(n) >= 1e6 || Math.abs(n) < 1e-3)) return n.toExponential(precision)
  return Number(n.toFixed(precision)).toString()
}

// ---------- step-by-step solution ----------

/** A piece of a formula with values filled in: text, or the value of a key (`deg`: an angle given in degrees). */
export type SubstitutionPart = string | { key: string; deg: boolean }

/**
 * The expression with every input, constant and earlier output marked for substitution, e.g.
 * `sqrt(mu / r)` → ['sqrt(', {key: 'mu'}, ' / ', {key: 'r'}, ')']. `theta deg` becomes one part with `deg`.
 */
export function substitutionParts(expr: string, known: Set<string>): SubstitutionPart[] {
  const open = ''
  const close = ''
  const text = limitedParse(expr).toString({
    handler: (node: MathNode) => {
      const n = node as MathNode & Record<string, unknown>
      if (node.type === 'SymbolNode' && known.has(n.name as string)) return `${open}${n.name}${close}`
      // `theta deg`: an input in degrees, shown as "30°".
      const args = n.args as MathNode[] | undefined
      if (
        node.type === 'OperatorNode' &&
        n.implicit &&
        args?.length === 2 &&
        args[0]?.type === 'SymbolNode' &&
        known.has((args[0] as MathNode & { name: string }).name) &&
        args[1]?.type === 'SymbolNode' &&
        (args[1] as MathNode & { name: string }).name === 'deg'
      )
        return `${open}${(args[0] as MathNode & { name: string }).name}°${close}`
      return undefined
    },
  })
  const parts: SubstitutionPart[] = []
  for (const [k, piece] of text.split(new RegExp(`[${open}${close}]`)).entries()) {
    if (k % 2 === 0) {
      if (piece) parts.push(piece)
    } else parts.push({ key: piece.replace(/°$/, ''), deg: piece.endsWith('°') })
  }
  return parts
}

/** A value as it appears in a substituted formula: negative values in parentheses, units kept. */
export function substitutedValue(value: number, precision: number, unit?: string, deg = false): string {
  const text = deg ? `${formatValue(value, precision)}°` : formatValue(value, precision)
  const withUnit = unit && !deg ? `${text} ${unit}` : text
  return value < 0 || (unit && !deg) ? `(${withUnit})` : withUnit
}

export interface CalculationStep {
  key: string
  label: string
  unit?: string
  explanation?: string
  /** The formula as written, e.g. `T = 2 * pi * sqrt(a^3 / mu)`. */
  formula: string
  /** The formula with the current values filled in; null when an earlier step failed. */
  substituted: string | null
  value: number | null
}

/** Each output as a step: what is computed, from which formula, with which values, and the result. */
export function calculationSteps(spec: CalculatorSpec, inputs: Record<string, number>): CalculationStep[] {
  const result = evaluateCalculator(spec, inputs)
  const known = new Set([...spec.inputs.map((i) => i.key), ...Object.keys(spec.constants ?? {})])
  const values = new Map<string, number>(Object.entries(spec.constants ?? {}))
  const units = new Map<string, string | undefined>()
  const precisions = new Map<string, number>()
  for (const inp of spec.inputs) {
    const v = inputs[inp.key] ?? inp.default
    if (v !== undefined && !Number.isNaN(v)) values.set(inp.key, v)
    units.set(inp.key, inp.unit)
  }
  for (const [key, meta] of Object.entries(spec.constantMetadata ?? {})) units.set(key, meta.unit)
  const steps: CalculationStep[] = []
  for (const out of spec.outputs) {
    const value = result.ok ? (result.values[out.key] ?? null) : null
    const parts = substitutionParts(out.expr, known)
    const ready = parts.every((p) => typeof p === 'string' || values.has(p.key))
    steps.push({
      key: out.key,
      label: out.label,
      unit: out.unit,
      explanation: out.explanation,
      formula: `${out.key} = ${out.expr}`,
      substituted: ready
        ? parts
            .map((p) =>
              typeof p === 'string'
                ? p
                : substitutedValue(
                    values.get(p.key) as number,
                    precisions.get(p.key) ?? 4,
                    units.get(p.key),
                    p.deg,
                  ),
            )
            .join('')
        : null,
      value,
    })
    known.add(out.key)
    units.set(out.key, out.unit)
    precisions.set(out.key, out.precision ?? 3)
    if (value !== null) values.set(out.key, value)
  }
  return steps
}

// ---------- code generation (export to Python / JavaScript) ----------

type Target = 'py' | 'js'

const FN_MAP: Record<Target, Record<string, string>> = {
  py: {
    sin: 'math.sin',
    cos: 'math.cos',
    tan: 'math.tan',
    asin: 'math.asin',
    acos: 'math.acos',
    atan: 'math.atan',
    atan2: 'math.atan2',
    sqrt: 'math.sqrt',
    exp: 'math.exp',
    log: 'math.log',
    log10: 'math.log10',
    abs: 'abs',
    floor: 'math.floor',
    ceil: 'math.ceil',
    min: 'min',
    max: 'max',
    round: 'round',
    sinh: 'math.sinh',
    cosh: 'math.cosh',
    tanh: 'math.tanh',
  },
  js: {
    sin: 'Math.sin',
    cos: 'Math.cos',
    tan: 'Math.tan',
    asin: 'Math.asin',
    acos: 'Math.acos',
    atan: 'Math.atan',
    atan2: 'Math.atan2',
    sqrt: 'Math.sqrt',
    exp: 'Math.exp',
    log: 'Math.log',
    log10: 'Math.log10',
    abs: 'Math.abs',
    floor: 'Math.floor',
    ceil: 'Math.ceil',
    min: 'Math.min',
    max: 'Math.max',
    round: 'Math.round',
    sinh: 'Math.sinh',
    cosh: 'Math.cosh',
    tanh: 'Math.tanh',
  },
}
const SYM_MAP: Record<Target, Record<string, string>> = {
  py: { pi: 'math.pi', e: 'math.e', deg: '(math.pi / 180)' },
  js: { pi: 'Math.PI', e: 'Math.E', deg: '(Math.PI / 180)' },
}

function compileNode(node: MathNode, target: Target, known: Set<string>): string {
  const n = node as MathNode & Record<string, unknown>
  switch (node.type) {
    case 'ConstantNode':
      if (typeof n.value === 'boolean') {
        if (target === 'py') return n.value ? 'True' : 'False'
        return n.value ? 'true' : 'false'
      }
      return String(n.value)
    case 'SymbolNode': {
      const name = n.name as string
      if (known.has(name)) return name
      const s = SYM_MAP[target][name]
      if (s) return s
      throw new Error(`Unknown symbol "${name}"`)
    }
    case 'ParenthesisNode':
      return `(${compileNode(n.content as MathNode, target, known)})`
    case 'OperatorNode': {
      const args = (n.args as MathNode[]).map((a) => compileNode(a, target, known))
      const fn = n.fn as string
      if (args.length === 1) {
        if (fn === 'unaryMinus') return `(-${args[0]})`
        if (fn === 'unaryPlus') return `(+${args[0]})`
        if (fn === 'factorial') throw new Error('factorial is not supported in export')
        if (fn === 'not') return target === 'py' ? `(not ${args[0]})` : `(!${args[0]})`
      }
      const op = n.op as string
      const mapped = op === '^' ? '**' : op === '.*' ? '*' : op === './' ? '/' : op
      if (args.length !== 2) throw new Error(`Operator "${op}" is not supported`)
      const operators: Record<Target, Record<string, string>> = {
        py: {
          '+': '+',
          '-': '-',
          '*': '*',
          '/': '/',
          '**': '**',
          '%': '%',
          '<': '<',
          '<=': '<=',
          '>': '>',
          '>=': '>=',
          '==': '==',
          '!=': '!=',
          and: 'and',
          or: 'or',
        },
        js: {
          '+': '+',
          '-': '-',
          '*': '*',
          '/': '/',
          '**': '**',
          '%': '%',
          '<': '<',
          '<=': '<=',
          '>': '>',
          '>=': '>=',
          '==': '===',
          '!=': '!==',
          and: '&&',
          or: '||',
        },
      }
      if (mapped === 'xor') {
        return target === 'py'
          ? `(bool(${args[0]}) != bool(${args[1]}))`
          : `(Boolean(${args[0]}) !== Boolean(${args[1]}))`
      }
      const exportOp = operators[target][mapped]
      if (!exportOp) throw new Error(`Operator "${op}" is not supported`)
      return `(${args[0]} ${exportOp} ${args[1]})`
    }
    case 'ConditionalNode': {
      const condition = compileNode(n.condition as MathNode, target, known)
      const trueExpr = compileNode(n.trueExpr as MathNode, target, known)
      const falseExpr = compileNode(n.falseExpr as MathNode, target, known)
      return target === 'py'
        ? `(${trueExpr} if ${condition} else ${falseExpr})`
        : `(${condition} ? ${trueExpr} : ${falseExpr})`
    }
    case 'FunctionNode': {
      const name = (n.fn as { name: string }).name
      const args = (n.args as MathNode[]).map((a) => compileNode(a, target, known))
      if (name === 'sign') {
        if (args.length !== 1) throw new Error('Function "sign" expects 1 argument')
        if (target === 'js') return `Math.sign(${args[0]})`
        return `(1 if ${args[0]} > 0 else (-1 if ${args[0]} < 0 else 0))`
      }
      if (name === 'log') {
        if (args.length < 1 || args.length > 2) throw new Error('Function "log" expects 1 or 2 arguments')
        if (args.length === 2 && target === 'js') return `(Math.log(${args[0]}) / Math.log(${args[1]}))`
      }
      if (name === 'round') {
        if (args.length < 1 || args.length > 2) throw new Error('Function "round" expects 1 or 2 arguments')
        const value = args[0]
        const factor = `10 ** ${args[1] ?? '0'}`
        return target === 'js'
          ? `(Math.sign(${value}) * Math.floor(Math.abs(${value}) * (${factor}) + 0.5) / (${factor}))`
          : `(math.copysign(math.floor(abs(${value}) * (${factor}) + 0.5) / (${factor}), ${value}))`
      }
      const f = FN_MAP[target][name]
      if (!f) throw new Error(`Function "${name}" is not supported in export`)
      if (['atan2'].includes(name) && args.length !== 2)
        throw new Error(`Function "${name}" expects 2 arguments`)
      if (['min', 'max'].includes(name) && args.length < 1)
        throw new Error(`Function "${name}" expects at least 1 argument`)
      if (!['atan2', 'log', 'min', 'max'].includes(name) && args.length !== 1)
        throw new Error(`Function "${name}" expects 1 argument`)
      return `${f}(${args.join(', ')})`
    }
    default:
      throw new Error(`Unsupported expression part: ${node.type}`)
  }
}

export function compileExpr(expr: string, target: Target, known: Set<string>): string {
  return compileNode(limitedParse(expr), target, known)
}

// ---------- Excel formulas ----------

const EXCEL_FN: Record<string, string> = {
  sin: 'SIN',
  cos: 'COS',
  tan: 'TAN',
  asin: 'ASIN',
  acos: 'ACOS',
  atan: 'ATAN',
  sqrt: 'SQRT',
  exp: 'EXP',
  log10: 'LOG10',
  abs: 'ABS',
  sign: 'SIGN',
  sinh: 'SINH',
  cosh: 'COSH',
  tanh: 'TANH',
}
const EXCEL_OP: Record<string, string> = {
  '+': '+',
  '-': '-',
  '*': '*',
  '/': '/',
  '^': '^',
  '.*': '*',
  './': '/',
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  '==': '=',
  '!=': '<>',
}

function compileExcelNode(node: MathNode, ref: (key: string) => string | undefined): string {
  const n = node as MathNode & Record<string, unknown>
  const sub = (m: MathNode) => compileExcelNode(m, ref)
  switch (node.type) {
    case 'ConstantNode':
      if (typeof n.value === 'boolean') return n.value ? 'TRUE' : 'FALSE'
      return String(n.value)
    case 'SymbolNode': {
      const name = n.name as string
      const cell = ref(name)
      if (cell) return cell
      if (name === 'pi') return 'PI()'
      if (name === 'e') return 'EXP(1)'
      if (name === 'deg') return '(PI()/180)'
      throw new Error(`Unknown symbol "${name}"`)
    }
    case 'ParenthesisNode':
      return `(${sub(n.content as MathNode)})`
    case 'OperatorNode': {
      const args = (n.args as MathNode[]).map(sub)
      const fn = n.fn as string
      // Every operation is parenthesised: Excel's unary minus binds tighter than ^ (-2^2 is 4 in Excel).
      if (args.length === 1) {
        if (fn === 'unaryMinus') return `(-${args[0]})`
        if (fn === 'unaryPlus') return `(${args[0]})`
        if (fn === 'not') return `NOT(${args[0]})`
        throw new Error(`Operator "${n.op}" is not supported in Excel export`)
      }
      const op = n.op as string
      if (op === '%' || op === 'mod') return `MOD(${args[0]},${args[1]})`
      if (op === 'and') return `AND(${args[0]},${args[1]})`
      if (op === 'or') return `OR(${args[0]},${args[1]})`
      if (op === 'xor') return `XOR(${args[0]},${args[1]})`
      const mapped = EXCEL_OP[op]
      if (!mapped || args.length !== 2) throw new Error(`Operator "${op}" is not supported in Excel export`)
      return `(${args[0]}${mapped}${args[1]})`
    }
    case 'ConditionalNode':
      return `IF(${sub(n.condition as MathNode)},${sub(n.trueExpr as MathNode)},${sub(n.falseExpr as MathNode)})`
    case 'FunctionNode': {
      const name = (n.fn as { name: string }).name
      const args = (n.args as MathNode[]).map(sub)
      const one = () => {
        if (args.length !== 1) throw new Error(`Function "${name}" expects 1 argument`)
        return args[0] as string
      }
      switch (name) {
        // Excel's ATAN2 takes x first.
        case 'atan2':
          if (args.length !== 2) throw new Error('Function "atan2" expects 2 arguments')
          return `ATAN2(${args[1]},${args[0]})`
        case 'log':
          if (args.length === 1) return `LN(${args[0]})`
          if (args.length === 2) return `LOG(${args[0]},${args[1]})`
          throw new Error('Function "log" expects 1 or 2 arguments')
        case 'floor':
          return `INT(${one()})`
        case 'ceil':
          return `(-INT(-${one()}))`
        case 'round':
          if (args.length < 1 || args.length > 2) throw new Error('Function "round" expects 1 or 2 arguments')
          return `ROUND(${args[0]},${args[1] ?? 0})`
        case 'min':
        case 'max':
          if (!args.length) throw new Error(`Function "${name}" expects at least 1 argument`)
          return `${name.toUpperCase()}(${args.join(',')})`
      }
      const f = EXCEL_FN[name]
      if (!f) throw new Error(`Function "${name}" is not supported in Excel export`)
      return `${f}(${one()})`
    }
    default:
      throw new Error(`Unsupported expression part: ${node.type}`)
  }
}

/** An Excel formula (without the leading =) for `expr`, with keys replaced by cell references from `ref`. */
export function compileExcel(expr: string, ref: (key: string) => string | undefined): string {
  return compileExcelNode(limitedParse(expr), ref)
}

export function exportJSON(spec: CalculatorSpec): string {
  return JSON.stringify(spec, null, 2)
}

const pyIdent = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_')

export function exportPython(spec: CalculatorSpec): string {
  const known = new Set([...spec.inputs.map((i) => i.key), ...Object.keys(spec.constants ?? {})])
  // A triple quote inside the text would end the docstring early.
  const doc = (text: string) => text.trim().replace(/"""/g, "'''")
  const lines: string[] = [
    `"""${spec.name}${spec.description ? `\n\n${doc(spec.description)}` : ''}${spec.theory?.trim() ? `\n\n${doc(spec.theory)}` : ''}\n\nExported from Notecyclopedia."""`,
    'import math',
    '',
    '',
  ]
  const params = spec.inputs.map((i) => `${i.key}: float${i.default !== undefined ? ` = ${i.default}` : ''}`)
  // Python requires parameters with defaults to come last; keep order but drop defaults if mixed.
  const mixed =
    spec.inputs.some((i) => i.default === undefined) && spec.inputs.some((i) => i.default !== undefined)
  const sig = mixed ? spec.inputs.map((i) => `${i.key}: float`) : params
  lines.push(`def ${pyIdent(spec.name.toLowerCase()) || 'calculate'}(${sig.join(', ')}) -> dict:`)
  for (const [k, v] of Object.entries(spec.constants ?? {})) lines.push(`    ${k} = ${v}`)
  for (const out of spec.outputs) {
    if (out.explanation) for (const line of out.explanation.split('\n')) lines.push(`    # ${line}`)
    lines.push(
      `    ${out.key} = ${compileExpr(out.expr, 'py', known)}  # ${out.label}${out.unit ? `, ${out.unit}` : ''}`,
    )
    known.add(out.key)
  }
  lines.push(`    return {${spec.outputs.map((o) => `"${o.key}": ${o.key}`).join(', ')}}`)
  lines.push('')
  return lines.join('\n')
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

/** JSON for a <script> block: `<` is escaped so text in the spec cannot close the script. */
const scriptJSON = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

const paragraphsHTML = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n')

/**
 * A standalone HTML page that works offline: the calculator, the theory behind it, and a step-by-step
 * solution that shows each formula with the current values filled in.
 */
export function exportHTML(spec: CalculatorSpec): string {
  const known = new Set([...spec.inputs.map((i) => i.key), ...Object.keys(spec.constants ?? {})])
  const body: string[] = []
  for (const [k, v] of Object.entries(spec.constants ?? {})) body.push(`const ${k} = ${v};`)
  const steps: { key: string; parts: SubstitutionPart[] }[] = []
  for (const out of spec.outputs) {
    body.push(`const ${out.key} = ${compileExpr(out.expr, 'js', known)};`)
    steps.push({ key: out.key, parts: substitutionParts(out.expr, known) })
    known.add(out.key)
  }
  const units: Record<string, string> = {}
  const precision: Record<string, number> = {}
  for (const i of spec.inputs) if (i.unit) units[i.key] = i.unit
  for (const [k, m] of Object.entries(spec.constantMetadata ?? {})) units[k] = m.unit
  for (const o of spec.outputs) {
    if (o.unit) units[o.key] = o.unit
    precision[o.key] = o.precision ?? 3
  }
  const inputsHtml = spec.inputs
    .map(
      (i) =>
        `<label>${esc(i.label)}${i.unit ? ` <small>(${esc(i.unit)})</small>` : ''}<input type="number" step="any" id="${i.key}" value="${i.default ?? 1}"></label>`,
    )
    .join('\n')
  const outputsHtml = spec.outputs
    .map(
      (o) =>
        `<div class="out"><span>${esc(o.label)}</span><b id="out_${o.key}">–</b> ${esc(o.unit ?? '')}</div>`,
    )
    .join('\n')
  const stepsHtml = spec.outputs
    .map(
      (o) => `<li><h3>${esc(o.label)}</h3>${o.explanation ? `<p>${esc(o.explanation)}</p>` : ''}
<div class="f">${esc(o.key)} = ${esc(o.expr)}</div>
<div class="f" id="sub_${o.key}"></div>
<div class="f res" id="res_${o.key}"></div></li>`,
    )
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(spec.name)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#F3F4F0;color:#16181D;margin:0;padding:24px;line-height:1.5}
main{max-width:720px;margin:auto;display:flex;flex-direction:column;gap:16px}
section{background:#fff;border:1px solid #DDDFD8;border-radius:14px;padding:24px}
h1{margin:0 0 4px;font-size:24px}h2{margin:0 0 12px;font-size:18px}h3{margin:0;font-size:15px}
p{color:#3d414a;margin:0 0 10px}.lead{color:#565B66}
label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:14px;margin-bottom:12px}
input{height:40px;padding:0 10px;border:1px solid #C9CCC4;border-radius:8px;font:16px ui-monospace,monospace}
.out{display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #ECEDE8}
.out b{font-family:ui-monospace,monospace;font-weight:500;margin-left:auto;margin-right:6px}
ol{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:16px}
li p{margin:4px 0 6px;font-size:14px}
.f{font-family:ui-monospace,monospace;font-size:14px;padding:2px 0;overflow-wrap:anywhere}
.f:empty{display:none}.res{font-weight:600}
</style></head><body><main>
<section><h1>${esc(spec.name)}</h1>${spec.description ? `<p class="lead">${esc(spec.description)}</p>` : ''}
${inputsHtml}
${outputsHtml}
</section>
${spec.theory?.trim() ? `<section><h2>Theory</h2>\n${paragraphsHTML(spec.theory)}\n</section>` : ''}
<section><h2>Step-by-step solution</h2><ol>
${stepsHtml}
</ol></section>
</main><script>
function calc(${spec.inputs.map((i) => i.key).join(', ')}) {
  ${body.join('\n  ')}
  return { ${spec.outputs.map((o) => o.key).join(', ')} };
}
const ids = ${scriptJSON(spec.inputs.map((i) => i.key))};
const constants = ${scriptJSON(spec.constants ?? {})};
const steps = ${scriptJSON(steps)};
const units = ${scriptJSON(units)};
const prec = ${scriptJSON(precision)};
function fmt(n, p) {
  if (n !== 0 && (Math.abs(n) >= 1e6 || Math.abs(n) < 1e-3)) return n.toExponential(p);
  return String(Number(n.toFixed(p)));
}
function shown(key, v, deg) {
  const text = deg ? fmt(v, prec[key] ?? 4) + '°' : fmt(v, prec[key] ?? 4);
  const unit = deg ? '' : units[key] || '';
  const withUnit = unit ? text + ' ' + unit : text;
  return v < 0 || unit ? '(' + withUnit + ')' : withUnit;
}
function run() {
  const values = Object.assign({}, constants);
  ids.forEach((id) => { values[id] = parseFloat(document.getElementById(id).value); });
  let r = {};
  try { r = calc(...ids.map((id) => values[id])); } catch (e) {}
  for (const s of steps) {
    const v = r[s.key];
    const ok = Number.isFinite(v);
    document.getElementById('out_' + s.key).textContent = ok ? fmt(v, prec[s.key]) : '–';
    const ready = s.parts.every((p) => typeof p === 'string' || Number.isFinite(values[p.key]));
    document.getElementById('sub_' + s.key).textContent = ready
      ? '= ' + s.parts.map((p) => (typeof p === 'string' ? p : shown(p.key, values[p.key], p.deg))).join('')
      : '';
    document.getElementById('res_' + s.key).textContent = ok ? '= ' + fmt(v, prec[s.key]) + (units[s.key] ? ' ' + units[s.key] : '') : '';
    if (ok) values[s.key] = v;
  }
}
ids.forEach((id) => document.getElementById(id).addEventListener('input', run));
run();
</script></body></html>
`
}
