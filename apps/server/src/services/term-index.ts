import { type DocJSON, extractReferences, extractTerms, withBlockIds } from '@nc/shared'
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
import { db, schema } from '../db'
import { type Tx, syncFormulas } from './formula-index'

/**
 * Update a page's terms (its headings) to match its document, matched by heading id so a term keeps its row
 * across edits. Pass a document that went through `withBlockIds`.
 */
export async function syncTerms(tx: Tx, pageId: string, doc: DocJSON) {
  const found = extractTerms(doc)
  await tx.delete(schema.terms).where(
    and(
      eq(schema.terms.pageId, pageId),
      found.length
        ? notInArray(
            schema.terms.nodeId,
            found.map((t) => t.nodeId),
          )
        : undefined,
    ),
  )
  if (!found.length) return
  await tx
    .insert(schema.terms)
    .values(found.map((t, position) => ({ ...t, pageId, position })))
    .onConflictDoUpdate({
      target: [schema.terms.pageId, schema.terms.nodeId],
      set: { position: sql`excluded.position`, text: sql`excluded.text`, level: sql`excluded.level` },
    })
}

/** Replace a page's outgoing references with the in-app links in its document; links to missing pages are skipped. */
export async function syncReferences(tx: Tx, pageId: string, doc: DocJSON) {
  await tx.delete(schema.pageReferences).where(eq(schema.pageReferences.sourcePageId, pageId))
  const links = extractReferences(doc).filter((l) => l.pageId !== pageId)
  if (!links.length) return
  const existing = new Set(
    (
      await tx
        .select({ id: schema.pages.id })
        .from(schema.pages)
        .where(
          inArray(
            schema.pages.id,
            links.map((l) => l.pageId),
          ),
        )
    ).map((p) => p.id),
  )
  const rows = links
    .filter((l) => existing.has(l.pageId))
    .map((l) => ({ sourcePageId: pageId, targetPageId: l.pageId, targetNodeId: l.nodeId }))
  if (rows.length) await tx.insert(schema.pageReferences).values(rows)
}

/**
 * Give headings saved before heading ids existed an id, and index the terms and references of those pages.
 * Only touches pages with a heading that has no id, so it is cheap to rerun. Returns the number of pages updated.
 */
export async function backfillTerms(): Promise<number> {
  const pending = await db
    .select({ id: schema.pages.id })
    .from(schema.pages)
    .where(
      sql`jsonb_path_exists(${schema.pages.content}, 'strict $.** ? (@.type == "heading" && !exists(@.attrs.id))')`,
    )
  for (const { id } of pending)
    await db.transaction(async (tx) => {
      const [page] = await tx
        .select({ content: schema.pages.content })
        .from(schema.pages)
        .where(eq(schema.pages.id, id))
        .for('update')
      if (!page) return
      const { doc, changed } = withBlockIds(page.content)
      if (changed) await tx.update(schema.pages).set({ content: doc }).where(eq(schema.pages.id, id))
      await syncFormulas(tx, id, doc)
      await syncTerms(tx, id, doc)
      await syncReferences(tx, id, doc)
    })
  return pending.length
}
