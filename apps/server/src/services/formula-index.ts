import { type DocJSON, extractFormulas, withFormulaIds } from '@nc/shared'
import { and, eq, isNull, notInArray, or, sql } from 'drizzle-orm'
import { db, schema } from '../db'

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Update a page's rows in the formula index to match its document. Rows are matched by the
 * formula block id, so a formula keeps its row id across edits. Pass a document that went through
 * `withFormulaIds`.
 */
export async function syncFormulas(tx: Tx, pageId: string, doc: DocJSON) {
  const found = extractFormulas(doc).filter((f): f is typeof f & { nodeId: string } => f.nodeId !== null)
  const nodeIds = found.map((f) => f.nodeId)
  await tx
    .delete(schema.formulas)
    .where(
      and(
        eq(schema.formulas.pageId, pageId),
        nodeIds.length
          ? or(isNull(schema.formulas.nodeId), notInArray(schema.formulas.nodeId, nodeIds))
          : undefined,
      ),
    )
  if (!found.length) return
  await tx
    .insert(schema.formulas)
    .values(found.map((f, position) => ({ ...f, pageId, position })))
    .onConflictDoUpdate({
      target: [schema.formulas.pageId, schema.formulas.nodeId],
      set: {
        position: sql`excluded.position`,
        label: sql`excluded.label`,
        latex: sql`excluded.latex`,
        description: sql`excluded.description`,
        pinned: sql`excluded.pinned`,
      },
    })
}

/**
 * Give formula blocks saved before formula ids existed an id, and key their index rows by it.
 * Only touches pages that still have index rows without a node id, so it is cheap to rerun.
 * Returns the number of pages updated.
 */
export async function backfillFormulaIds(): Promise<number> {
  const pending = await db
    .selectDistinct({ pageId: schema.formulas.pageId })
    .from(schema.formulas)
    .where(isNull(schema.formulas.nodeId))
  for (const { pageId } of pending)
    await db.transaction(async (tx) => {
      const [page] = await tx
        .select({ content: schema.pages.content })
        .from(schema.pages)
        .where(eq(schema.pages.id, pageId))
        .for('update')
      if (!page) return
      const { doc, changed } = withFormulaIds(page.content)
      if (changed) await tx.update(schema.pages).set({ content: doc }).where(eq(schema.pages.id, pageId))
      await syncFormulas(tx, pageId, doc)
    })
  return pending.length
}
