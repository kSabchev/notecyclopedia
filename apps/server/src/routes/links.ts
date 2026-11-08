import { and, asc, eq } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { db, schema } from '../db'
import { HttpError, me, param } from '../http'

/** Your own entries on the Useful links page. */
export const links = Router()

/** Only web addresses: a link is opened in a new tab, so no javascript:, data: or file: URLs. */
const webUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }, 'Enter a web address starting with http:// or https://')

links.get('/', async (req, res) => {
  const rows = await db
    .select({
      id: schema.userLinks.id,
      title: schema.userLinks.title,
      url: schema.userLinks.url,
      note: schema.userLinks.note,
    })
    .from(schema.userLinks)
    .where(eq(schema.userLinks.userId, me(req).id))
    .orderBy(asc(schema.userLinks.createdAt))
  res.json(rows)
})

links.post('/', async (req, res) => {
  const body = z
    .object({
      title: z.string().trim().min(1).max(120),
      url: webUrl,
      note: z.string().trim().max(300).optional(),
    })
    .parse(req.body)
  const [row] = await db
    .insert(schema.userLinks)
    .values({ userId: me(req).id, title: body.title, url: body.url, note: body.note || null })
    .returning({
      id: schema.userLinks.id,
      title: schema.userLinks.title,
      url: schema.userLinks.url,
      note: schema.userLinks.note,
    })
  res.status(201).json(row)
})

links.delete('/:id', async (req, res) => {
  const [row] = await db
    .delete(schema.userLinks)
    .where(
      and(
        eq(schema.userLinks.id, z.string().uuid().parse(param(req, 'id'))),
        eq(schema.userLinks.userId, me(req).id),
      ),
    )
    .returning({ id: schema.userLinks.id })
  if (!row) throw new HttpError(404, 'Link not found')
  res.status(204).end()
})
