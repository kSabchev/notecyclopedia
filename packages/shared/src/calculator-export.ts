import type { CalculatorSpec } from './calculator'
import { compileExpr } from './calculator-code'
import { type SubstitutionPart, substitutionParts } from './calculator-steps'

/** A calculator exported as JSON, a Python script and a standalone HTML page. */

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
