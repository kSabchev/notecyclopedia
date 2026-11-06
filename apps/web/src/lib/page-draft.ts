/**
 * Text to add at the end of a page, handed from where it was made (an AI answer) to the page editor, which inserts
 * it as an unsaved change for the user to review and save. Kept for this browser tab only.
 */
export interface PageAppend {
  /** A short heading for the added section. */
  title: string
  /** Markdown with LaTeX, as AI answers are written. */
  markdown: string
}

const key = (pageId: string) => `nc.pageAppend.${pageId}`

export function stashAppend(pageId: string, draft: PageAppend) {
  try {
    sessionStorage.setItem(key(pageId), JSON.stringify(draft))
  } catch {
    // Storage blocked: the editor simply opens without the addition.
  }
}

/** The pending addition for a page, removed once taken. */
export function takeAppend(pageId: string): PageAppend | null {
  try {
    const raw = sessionStorage.getItem(key(pageId))
    if (!raw) return null
    sessionStorage.removeItem(key(pageId))
    const parsed = JSON.parse(raw) as PageAppend
    return typeof parsed.title === 'string' && typeof parsed.markdown === 'string' ? parsed : null
  } catch {
    return null
  }
}
