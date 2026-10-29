import { type CalculatorSpec, compileExcel, defaultInputs, evaluateCalculator } from './calculator'

/**
 * An Excel workbook (.xlsx) for a calculator, as the files of its zip archive. Inputs are editable cells;
 * every result is an Excel formula over them, listed as a step with its formula and explanation.
 * A second sheet holds the theory. Zipping is left to the caller.
 */

// Characters XML 1.0 does not allow, which would make Excel reject the file.
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g
const xml = (s: string) =>
  s
    .replace(INVALID_XML, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const STYLE = { normal: 0, bold: 1, input: 2, wrap: 3, title: 4 } as const
type Cell =
  | { text: string; style?: number }
  | { number: number; style?: number }
  | { formula: string; cached?: number }

function cellXml(ref: string, cell: Cell): string {
  if ('formula' in cell)
    return `<c r="${ref}"><f>${xml(cell.formula)}</f>${cell.cached !== undefined ? `<v>${cell.cached}</v>` : ''}</c>`
  const s = cell.style ? ` s="${cell.style}"` : ''
  if ('number' in cell) return `<c r="${ref}"${s}><v>${cell.number}</v></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`
}

const COLUMNS = 'ABCDEF'
function sheetXml(rows: (Cell | null)[][], widths: number[]): string {
  const body = rows
    .map((cells, r) => {
      const content = cells.map((cell, c) => (cell ? cellXml(`${COLUMNS[c]}${r + 1}`, cell) : '')).join('')
      return content ? `<row r="${r + 1}">${content}</row>` : ''
    })
    .join('')
  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`
}

const text = (t: string, style?: number): Cell => ({ text: t, style })
const header = (...labels: string[]) => labels.map((l) => text(l, STYLE.bold))

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

export function calculatorWorkbook(spec: CalculatorSpec): { path: string; content: string }[] {
  const rows: (Cell | null)[][] = [[text(spec.name, STYLE.title)]]
  if (spec.description) rows.push([text(spec.description)])
  rows.push([], header('Inputs', 'Value', 'Unit', 'Key'))
  const cellOf = new Map<string, string>()
  const defaults = defaultInputs(spec)
  for (const input of spec.inputs) {
    cellOf.set(input.key, `$B$${rows.length + 1}`)
    rows.push([
      text(input.label),
      { number: defaults[input.key] ?? 1, style: STYLE.input },
      text(input.unit ?? ''),
      text(input.key),
    ])
  }
  const constants = Object.entries(spec.constants ?? {})
  if (constants.length) {
    rows.push([], header('Constants', 'Value', 'Unit', 'Key'))
    for (const [key, value] of constants) {
      const meta = spec.constantMetadata?.[key]
      cellOf.set(key, `$B$${rows.length + 1}`)
      rows.push([text(meta?.name ?? key), { number: value }, text(meta?.unit ?? ''), text(key)])
    }
  }
  rows.push([], header('Step-by-step results', 'Value', 'Unit', 'Key', 'Formula', 'Explanation'))
  // Cached results let viewers that do not recalculate still show values; Excel recalculates on open.
  const result = evaluateCalculator(spec, defaults)
  spec.outputs.forEach((out, index) => {
    const formula = compileExcel(out.expr, (key) => cellOf.get(key))
    cellOf.set(out.key, `$B$${rows.length + 1}`)
    rows.push([
      text(`${index + 1}. ${out.label}`),
      { formula, cached: result.ok ? result.values[out.key] : undefined },
      text(out.unit ?? ''),
      text(out.key),
      text(`${out.key} = ${out.expr}`),
      text(out.explanation ?? '', STYLE.wrap),
    ])
  })
  rows.push([], [text('Change the yellow input cells; the results update.')])

  const sheets = [{ name: 'Calculator', xml: sheetXml(rows, [34, 16, 12, 12, 40, 60]) }]
  const paragraphs = (spec.theory ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paragraphs.length)
    sheets.push({
      name: 'Theory',
      xml: sheetXml([[text('Theory', STYLE.title)], ...paragraphs.map((p) => [text(p, STYLE.wrap)])], [110]),
    })

  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')
  const sheetEntries = sheets
    .map((sh, i) => `<sheet name="${sh.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')
  const sheetRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')
  return [
    {
      path: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`,
    },
    {
      path: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      path: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { path: 'xl/styles.xml', content: STYLES },
    ...sheets.map((sh, i) => ({ path: `xl/worksheets/sheet${i + 1}.xml`, content: sh.xml })),
  ]
}
