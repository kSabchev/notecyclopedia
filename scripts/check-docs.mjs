// Checks the relative links in the documentation: every linked file exists, and every #anchor names a heading of the
// linked Markdown file. Run with `pnpm docs:check`; CI runs it too.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const files = [
  'README.md',
  'design/README.md',
  ...readdirSync(path.join(root, 'docs')).map((f) => `docs/${f}`),
].filter((f) => f.endsWith('.md'))

/** GitHub's heading anchor: lower case, punctuation dropped, spaces as hyphens. */
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-')

const anchors = (file) =>
  new Set(
    [
      ...readFileSync(file, 'utf8')
        .replace(/```[\s\S]*?```/g, '')
        .matchAll(/^#{1,6} (.+)$/gm),
    ].map((m) => slug(m[1])),
  )

const problems = []
for (const file of files) {
  const text = readFileSync(path.join(root, file), 'utf8').replace(/```[\s\S]*?```/g, '')
  for (const [, link] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(link)) continue
    const [target, anchor] = link.split('#')
    const resolved = target ? path.resolve(root, path.dirname(file), target) : path.join(root, file)
    if (!existsSync(resolved)) problems.push(`${file}: ${link} (no such file)`)
    else if (anchor && resolved.endsWith('.md') && !anchors(resolved).has(anchor))
      problems.push(`${file}: ${link} (no such heading)`)
  }
}

if (problems.length) {
  console.error(`Broken documentation links:\n${problems.map((p) => `  ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`Documentation links OK (${files.length} files).`)
