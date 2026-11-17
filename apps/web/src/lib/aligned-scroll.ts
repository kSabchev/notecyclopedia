import { type RefObject, useEffect } from 'react'

/** How far below a pane's top the panes are lined up: a heading on this line is at the same height in both. */
export const READING_LINE = 24

/** The top of each heading with an id in a scroll pane, measured from the top of its content. */
function headingTops(pane: HTMLElement): Map<string, number> {
  const base = pane.getBoundingClientRect().top - pane.scrollTop
  const tops = new Map<string, number>()
  for (const h of pane.querySelectorAll<HTMLElement>('h2[id], h3[id]'))
    tops.set(h.id, h.getBoundingClientRect().top - base)
  return tops
}

/**
 * Where `to` should scroll so it shows what `from` shows at the reading line: a heading both panes have (in the same
 * order) is put at the same height, and positions between two headings are spread evenly.
 */
function alignedTop(from: HTMLElement, to: HTMLElement): number {
  const a = headingTops(from)
  const b = headingTops(to)
  const pairs: [number, number][] = [[0, 0]]
  for (const [id, top] of a) {
    const other = b.get(id)
    const last = pairs.at(-1) as [number, number]
    // A heading the AI moved is left out, so the mapping only ever moves forward.
    if (other !== undefined && top > last[0] && other > last[1]) pairs.push([top, other])
  }
  const end: [number, number] = [from.scrollHeight, to.scrollHeight]
  if (end[0] > (pairs.at(-1) as [number, number])[0]) pairs.push(end)
  const y = from.scrollTop + READING_LINE
  let i = 0
  while (i < pairs.length - 2 && (pairs[i + 1] as [number, number])[0] <= y) i++
  const [x0, y0] = pairs[i] as [number, number]
  const [x1, y1] = pairs[i + 1] ?? [x0 + 1, y0 + 1]
  return y0 + ((y - x0) / (x1 - x0)) * (y1 - y0) - READING_LINE
}

/**
 * Keep two scroll panes showing the same part of a page (an original and its revision), by heading. When `start`
 * names a heading, both panes first scroll to it.
 */
export function useAlignedScroll(
  left: RefObject<HTMLElement | null>,
  right: RefObject<HTMLElement | null>,
  start?: string,
) {
  useEffect(() => {
    const a = left.current
    const b = right.current
    if (!a || !b) return
    // The scroll position each pane was moved to here, so that move is not taken for the user's.
    const moved = new Map<HTMLElement, number>()
    const set = (pane: HTMLElement, to: number) => {
      const top = Math.max(0, Math.min(Math.round(to), pane.scrollHeight - pane.clientHeight))
      if (Math.abs(pane.scrollTop - top) < 1) return
      moved.set(pane, top)
      pane.scrollTop = top
    }
    // The pane the user scrolled last leads; until they scroll, the start heading is kept in view.
    let leader = a
    let scrolled = false
    const toStart = () => {
      const heading = start === undefined ? undefined : headingTops(a).get(start)
      if (heading !== undefined) set(a, heading - READING_LINE)
    }
    const sync = () => {
      if (!scrolled) toStart()
      const other = leader === a ? b : a
      set(other, alignedTop(leader, other))
    }
    const onScroll = (pane: HTMLElement) => () => {
      if (Math.abs(pane.scrollTop - (moved.get(pane) ?? Number.NaN)) < 2) return
      moved.delete(pane)
      leader = pane
      scrolled = true
      sync()
    }
    const onA = onScroll(a)
    const onB = onScroll(b)
    a.addEventListener('scroll', onA, { passive: true })
    b.addEventListener('scroll', onB, { passive: true })
    // Content that changes size (fonts and math loading, edits in the proposal) moves the headings.
    const resized = new ResizeObserver(sync)
    for (const pane of [a, b]) for (const child of pane.children) resized.observe(child)
    sync()
    return () => {
      a.removeEventListener('scroll', onA)
      b.removeEventListener('scroll', onB)
      resized.disconnect()
    }
  }, [left, right, start])
}
