import { docToText } from './doc'
import type { DocJSON } from './types'

/** Plain text of each top-level block (paragraph, heading, list, formula…), for comparing revisions. */
export function docBlocks(doc: DocJSON | null | undefined): string[] {
  return (doc?.content ?? [])
    .map((node) => docToText({ type: 'doc', content: [node] }))
    .filter((text) => text.length > 0)
}

export type DiffLine = { op: 'same' | 'add' | 'remove'; text: string }

/** Line diff from `before` to `after` (longest common subsequence), in reading order. */
export function diffLines(before: string[], after: string[]): DiffLine[] {
  const n = before.length
  const m = after.length
  // lcs[i][j] = length of the longest common subsequence of before[i..] and after[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      (lcs[i] as number[])[j] =
        before[i] === after[j]
          ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((lcs[i + 1] as number[])[j] as number, (lcs[i] as number[])[j + 1] as number)
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ op: 'same', text: before[i++] as string })
      j++
    } else if (((lcs[i + 1] as number[])[j] as number) >= ((lcs[i] as number[])[j + 1] as number))
      out.push({ op: 'remove', text: before[i++] as string })
    else out.push({ op: 'add', text: after[j++] as string })
  }
  while (i < n) out.push({ op: 'remove', text: before[i++] as string })
  while (j < m) out.push({ op: 'add', text: after[j++] as string })
  return out
}
