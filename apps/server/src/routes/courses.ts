import { and, eq, sql } from 'drizzle-orm'
import { Router } from 'express'
import { z } from 'zod'
import { assertCourse } from '../access'
import { db, schema } from '../db'
import { HttpError, me, param } from '../http'

export const courses = Router()

courses.get('/', async (req, res) => {
  const rows = await db
    .select({
      id: schema.courses.id,
      name: schema.courses.name,
      color: schema.courses.color,
      description: schema.courses.description,
      createdAt: schema.courses.createdAt,
      role: schema.courseMembers.role,
    })
    .from(schema.courseMembers)
    .innerJoin(schema.courses, eq(schema.courses.id, schema.courseMembers.courseId))
    .where(eq(schema.courseMembers.userId, me(req).id))
    .orderBy(schema.courses.name)
  res.json(rows)
})

const courseInput = z.object({
  name: z.string().trim().min(1).max(120),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  description: z.string().max(2000).nullish(),
})

courses.post('/', async (req, res) => {
  const body = courseInput.parse(req.body)
  const user = me(req)
  const course = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(schema.courses)
      .values({ ...body, createdBy: user.id })
      .returning()
    if (!c) throw new Error('insert failed')
    await tx.insert(schema.courseMembers).values({ courseId: c.id, userId: user.id, role: 'owner' })
    return c
  })
  res.status(201).json({ ...course, role: 'owner' })
})

courses.patch('/:id', async (req, res) => {
  const id = param(req, 'id')
  await assertCourse(id, me(req).id, 'owner')
  const body = courseInput.partial().parse(req.body)
  const [c] = await db.update(schema.courses).set(body).where(eq(schema.courses.id, id)).returning()
  res.json(c)
})

courses.delete('/:id', async (req, res) => {
  const id = param(req, 'id')
  await assertCourse(id, me(req).id, 'owner')
  await db.delete(schema.courses).where(eq(schema.courses.id, id))
  res.status(204).end()
})

courses.get('/:id/members', async (req, res) => {
  const id = param(req, 'id')
  await assertCourse(id, me(req).id)
  const rows = await db
    .select({
      userId: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.courseMembers.role,
    })
    .from(schema.courseMembers)
    .innerJoin(schema.user, eq(schema.user.id, schema.courseMembers.userId))
    .where(eq(schema.courseMembers.courseId, id))
  res.json(rows)
})

courses.post('/:id/members', async (req, res) => {
  const id = param(req, 'id')
  await assertCourse(id, me(req).id, 'owner')
  const { email, role } = z
    .object({ email: z.string().email(), role: z.enum(['editor', 'viewer']) })
    .parse(req.body)
  const [u] = await db.select().from(schema.user).where(sql`lower(${schema.user.email}) = lower(${email})`)
  if (!u) throw new HttpError(404, 'No account with that email yet — ask them to sign up first')
  await db
    .insert(schema.courseMembers)
    .values({ courseId: id, userId: u.id, role })
    .onConflictDoUpdate({
      target: [schema.courseMembers.courseId, schema.courseMembers.userId],
      set: { role },
    })
  res.status(201).json({ userId: u.id, name: u.name, email: u.email, role })
})

courses.delete('/:id/members/:userId', async (req, res) => {
  const id = param(req, 'id')
  const userId = param(req, 'userId')
  await assertCourse(id, me(req).id, 'owner')
  if (userId === me(req).id) throw new HttpError(400, 'Owners cannot remove themselves')
  await db
    .delete(schema.courseMembers)
    .where(and(eq(schema.courseMembers.courseId, id), eq(schema.courseMembers.userId, userId)))
  res.status(204).end()
})
