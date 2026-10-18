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
})

export const calculatorSpecSchema = z
  .object({
    version: z.literal(1).default(1),
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    inputs: z.array(calculatorInputSchema).min(1).max(30),
    outputs: z.array(calculatorOutputSchema).min(1).max(30),
    constants: z.record(key, z.number()).optional(),
  })
  .superRefine((spec, ctx) => {
    const seen = new Set<string>()
    for (const k of [
      ...spec.inputs.map((i) => i.key),
      ...Object.keys(spec.constants ?? {}),
      ...spec.outputs.map((o) => o.key),
    ]) {
      if (seen.has(k)) ctx.addIssue({ code: 'custom', message: `Duplicate key "${k}"` })
      seen.add(k)
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
      }
      const op = n.op as string
      const mapped = op === '^' ? '**' : op === '.*' ? '*' : op === './' ? '/' : op
      if (!['+', '-', '*', '/', '**', '%'].includes(mapped))
        throw new Error(`Operator "${op}" is not supported`)
      return `(${args[0]} ${mapped} ${args[1]})`
    }
    case 'FunctionNode': {
      const name = (n.fn as { name: string }).name
      const f = FN_MAP[target][name]
      if (!f) throw new Error(`Function "${name}" is not supported in export`)
      const args = (n.args as MathNode[]).map((a) => compileNode(a, target, known))
      return `${f}(${args.join(', ')})`
    }
    default:
      throw new Error(`Unsupported expression part: ${node.type}`)
  }
}

export function compileExpr(expr: string, target: Target, known: Set<string>): string {
  return compileNode(limitedParse(expr), target, known)
}

export function exportJSON(spec: CalculatorSpec): string {
  return JSON.stringify(spec, null, 2)
}

const pyIdent = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_')

export function exportPython(spec: CalculatorSpec): string {
  const known = new Set([...spec.inputs.map((i) => i.key), ...Object.keys(spec.constants ?? {})])
  const lines: string[] = [
    `"""${spec.name}${spec.description ? `\n\n${spec.description}` : ''}\n\nExported from Notecyclopedia."""`,
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

/** A standalone HTML page with the calculator working offline. */
export function exportHTML(spec: CalculatorSpec): string {
  const known = new Set([...spec.inputs.map((i) => i.key), ...Object.keys(spec.constants ?? {})])
  const body: string[] = []
  for (const [k, v] of Object.entries(spec.constants ?? {})) body.push(`const ${k} = ${v};`)
  for (const out of spec.outputs) {
    body.push(`const ${out.key} = ${compileExpr(out.expr, 'js', known)};`)
    known.add(out.key)
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
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(spec.name)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#F3F4F0;color:#16181D;margin:0;padding:24px}
main{max-width:560px;margin:auto;background:#fff;border:1px solid #DDDFD8;border-radius:14px;padding:24px}
h1{margin:0 0 4px;font-size:22px}p{color:#565B66;margin:0 0 16px}
label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:14px;margin-bottom:12px}
input{height:40px;padding:0 10px;border:1px solid #C9CCC4;border-radius:8px;font:16px ui-monospace,monospace}
.out{display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #ECEDE8}
.out b{font-family:ui-monospace,monospace;font-weight:500;margin-left:auto;margin-right:6px}
</style></head><body><main>
<h1>${esc(spec.name)}</h1>${spec.description ? `<p>${esc(spec.description)}</p>` : ''}
${inputsHtml}
${outputsHtml}
</main><script>
function calc(${spec.inputs.map((i) => i.key).join(', ')}) {
  ${body.join('\n  ')}
  return { ${spec.outputs.map((o) => o.key).join(', ')} };
}
const ids = ${JSON.stringify(spec.inputs.map((i) => i.key))};
const prec = ${JSON.stringify(Object.fromEntries(spec.outputs.map((o) => [o.key, o.precision ?? 3])))};
function run() {
  const r = calc(...ids.map((id) => parseFloat(document.getElementById(id).value)));
  for (const k in r) document.getElementById('out_' + k).textContent = Number.isFinite(r[k]) ? Number(r[k].toFixed(prec[k])) : '–';
}
ids.forEach((id) => document.getElementById(id).addEventListener('input', run));
run();
</script></body></html>
`
}
