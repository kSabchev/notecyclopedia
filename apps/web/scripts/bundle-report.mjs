// Reports how much JavaScript each part of the app downloads (gzip), following static imports from the
// build manifest. Run after `vite build`: `node scripts/bundle-report.mjs [--json]`.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const dist = path.resolve(import.meta.dirname, '../dist')
const manifest = JSON.parse(readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'))
const size = new Map()
const gz = (file) => {
  if (!size.has(file)) size.set(file, gzipSync(readFileSync(path.join(dist, file))).length)
  return size.get(file)
}

/** Files loaded with an entry: the entry and every chunk it imports statically, transitively. */
function closure(key, seen = new Set()) {
  const chunk = manifest[key]
  if (!chunk || seen.has(chunk.file)) return seen
  seen.add(chunk.file)
  for (const k of chunk.imports ?? []) closure(k, seen)
  return seen
}

const shell = closure('index.html')
const parts = {
  'App shell (every page)': 'index.html',
  'Page view (reading)': 'src/routes/PageView.tsx',
  'Page editor': 'src/routes/PageEdit.tsx',
  'Course overview': 'src/routes/Wiki.tsx',
  'AI portal': 'src/routes/AiPortal.tsx',
  'Formula rendering (KaTeX)': 'src/components/Tex.tsx',
  'Orbit diagram': 'src/components/widgets/OrbitView.tsx',
  'Calculator / plot block': 'src/components/widgets/CalculatorWidgetBlock.tsx',
}
const rows = Object.entries(parts).map(([name, key]) => {
  if (!manifest[key]) return { name, kB: null }
  const files = [...closure(key)].filter((f) => key === 'index.html' || !shell.has(f))
  return { name, kB: Math.round(files.reduce((n, f) => n + gz(f), 0) / 102.4) / 10 }
})
if (process.argv.includes('--json')) console.log(JSON.stringify(rows))
else {
  console.log('JavaScript downloaded, gzip (beyond the app shell for each route):')
  for (const r of rows) console.log(`  ${r.name.padEnd(30)} ${r.kB === null ? 'n/a' : `${r.kB} kB`}`)
}
