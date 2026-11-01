import { type DocJSON, imageFileIds, invalidWidget, withBlockIds } from '@nc/shared'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { schema } from '../db'
import { HttpError } from '../http'
import { type Tx, syncFormulas } from './formula-index'
import { syncReferences, syncTerms } from './term-index'

/** Check a page document before saving it and give its formula and heading blocks ids. Throws 400 for invalid widgets. */
export function preparePageContent(doc: DocJSON): DocJSON {
  const problem = invalidWidget(doc)
  if (problem) throw new HttpError(400, problem)
  return withBlockIds(doc).doc
}

/**
 * Update what is derived from a saved document: the formula and term indexes, the page's references to
 * other pages, and the page link of files shown
 * in image blocks (an image uploaded before the page existed has none), so they move with the page.
 */
export async function syncPageContent(tx: Tx, page: { id: string; courseId: string }, doc: DocJSON) {
  await syncFormulas(tx, page.id, doc)
  await syncTerms(tx, page.id, doc)
  await syncReferences(tx, page.id, doc)
  const fileIds = imageFileIds(doc)
  if (fileIds.length)
    await tx
      .update(schema.files)
      .set({ pageId: page.id })
      .where(
        and(
          inArray(schema.files.id, fileIds),
          eq(schema.files.courseId, page.courseId),
          isNull(schema.files.pageId),
        ),
      )
}
