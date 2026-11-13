import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startTestApi } from '../testing/api'
import { testDatabaseUrl } from '../testing/database'

test(
  'courses: order, members and roles, constants, leaving and deleting',
  {
    skip: !testDatabaseUrl,
    timeout: 120_000,
  },
  async (t) => {
    if (!testDatabaseUrl) return
    const api = await startTestApi(t, testDatabaseUrl)
    const { db, schema, request, send, ok } = api
    const { eq } = api.orm
    const owner = await api.signup('owner')
    const editor = await api.signup('editor')
    const viewer = await api.signup('viewer')
    const outsider = await api.signup('outsider')
    type Course = { id: string; name: string; color: string | null; role: string }
    const myCourses = async (actor = owner) =>
      (await ok<Course[]>(request(actor, '/courses'))).map((c) => c.id)

    await t.test('new accounts and malformed requests', async () => {
      const [row] = await db
        .select({ timezone: schema.user.timezone })
        .from(schema.user)
        .where(eq(schema.user.id, owner.id))
      assert.equal(row?.timezone, 'Europe/Sofia', 'New accounts default to Eastern European Time')
      const malformed = await request(owner, '/courses', { method: 'POST', body: '{"name":' })
      assert.equal(malformed.status, 400, 'A malformed body is the client’s error, not a server failure')
      assert.equal((await send(owner, 'POST', '/courses', { name: '' })).status, 400)
    })

    const astro = await api.createCourse(owner, 'Astrodynamics')
    const mission = await api.createCourse(owner, 'Mission design')

    await t.test('your courses, in your order', async () => {
      assert.equal(astro.role, 'owner')
      assert.deepEqual(await myCourses(), [astro.id, mission.id])
      assert.equal(
        (await send(owner, 'PUT', '/courses/order', { courseIds: [astro.id, astro.id] })).status,
        400,
      )
      assert.equal(
        (await send(owner, 'PUT', '/courses/order', { courseIds: [mission.id] })).status,
        400,
        'The order lists every course',
      )
      assert.equal(
        (await send(owner, 'PUT', '/courses/order', { courseIds: [mission.id, astro.id] })).status,
        204,
      )
      assert.deepEqual(await myCourses(), [mission.id, astro.id])
      assert.deepEqual(await myCourses(outsider), [])

      const renamed = await ok<Course>(send(owner, 'PATCH', `/courses/${astro.id}`, { color: '#336699' }))
      assert.deepEqual([renamed.name, renamed.color], ['Astrodynamics', '#336699'])
      assert.equal((await send(owner, 'PATCH', `/courses/${astro.id}`, { color: 'blue' })).status, 400)
    })

    await t.test('members and roles', async () => {
      await api.addMember(owner, astro.id, editor, 'editor')
      await api.addMember(owner, astro.id, viewer, 'viewer')
      const invite = (actor: typeof owner, email: string, role = 'viewer') =>
        send(actor, 'POST', `/courses/${astro.id}/members`, { email, role })
      assert.equal((await invite(owner, 'nobody@example.test')).status, 404, 'Only people with an account')
      assert.equal((await invite(owner, outsider.email, 'owner')).status, 400, 'There is one owner')
      assert.equal((await invite(editor, outsider.email)).status, 403, 'Only the owner adds members')
      assert.equal((await request(outsider, `/courses/${astro.id}/members`)).status, 404)
      const roles = async () =>
        Object.fromEntries(
          (await ok<{ userId: string; role: string }[]>(request(viewer, `/courses/${astro.id}/members`))).map(
            (m) => [m.userId, m.role],
          ),
        )
      assert.deepEqual(await roles(), { [owner.id]: 'owner', [editor.id]: 'editor', [viewer.id]: 'viewer' })
      // Adding a member again changes their role.
      await api.addMember(owner, astro.id, viewer, 'editor')
      assert.equal((await roles())[viewer.id], 'editor')
      await api.addMember(owner, astro.id, viewer, 'viewer')
      assert.equal((await send(editor, 'PATCH', `/courses/${astro.id}`, { name: 'Mine now' })).status, 403)
      assert.deepEqual(await myCourses(viewer), [astro.id])
    })

    await t.test('course constants: members read them, editors change them', async () => {
      const constant = (key: string, value: number) => ({
        key,
        name: 'Speed of sound',
        symbol: 'c_s',
        value,
        unit: 'm/s',
        description: 'Approximate value in dry air at 20 °C.',
      })
      const base = `/courses/${astro.id}/constants`
      const sound = await ok<{ id: string; value: number }>(
        send(editor, 'POST', base, constant('SOUND_SPEED', 343)),
        201,
      )
      assert.equal(sound.value, 343)
      assert.deepEqual(
        (await ok<{ id: string }[]>(request(viewer, base))).map((c) => c.id),
        [sound.id],
      )
      assert.equal((await request(outsider, base)).status, 404)
      assert.equal((await send(viewer, 'POST', base, constant('FORBIDDEN', 1))).status, 403)
      assert.equal(
        (await send(editor, 'POST', base, constant('SOUND_SPEED', 1))).status,
        409,
        'Keys are unique',
      )
      assert.equal(
        (await send(editor, 'POST', base, constant('G0', 9.8))).status,
        400,
        'Built-in keys are taken',
      )
      assert.equal(
        (await send(editor, 'POST', base, constant('2x', 1))).status,
        400,
        'Keys are variable names',
      )

      const updated = await ok<{ value: number }>(
        send(editor, 'PUT', `${base}/${sound.id}`, constant('SOUND_SPEED', 344)),
      )
      assert.equal(updated.value, 344)
      const rho = await ok<{ id: string }>(send(editor, 'POST', base, constant('RHO', 1.2)), 201)
      assert.equal((await send(editor, 'PUT', `${base}/${rho.id}`, constant('SOUND_SPEED', 1))).status, 409)
      assert.equal(
        (await send(editor, 'PUT', `${base}/${crypto.randomUUID()}`, constant('NEW', 1))).status,
        404,
      )
      assert.equal(
        (await send(owner, 'PUT', `/courses/${mission.id}/constants/${rho.id}`, constant('RHO', 1))).status,
        404,
        'A constant is changed through its own course',
      )
      assert.equal((await request(viewer, `${base}/${rho.id}`, { method: 'DELETE' })).status, 403)
      assert.equal((await request(editor, `${base}/${rho.id}`, { method: 'DELETE' })).status, 204)
      assert.equal((await request(editor, `${base}/${rho.id}`, { method: 'DELETE' })).status, 404)
    })

    await t.test('leaving a course clears the course tag of your calculators; they stay yours', async () => {
      const calc = await api.createCalculator(viewer, 'Escape speed', {
        courseId: astro.id,
        lectureNumber: 2,
      })
      assert.deepEqual([calc.courseId, calc.lectureNumber], [astro.id, 2])
      assert.equal(
        (await request(owner, `/calculators/${calc.id}`)).status,
        404,
        'Calculators are not shared',
      )
      const remove = (actor: typeof owner, member: typeof owner) =>
        request(actor, `/courses/${astro.id}/members/${member.id}`, { method: 'DELETE' })
      assert.equal((await remove(owner, owner)).status, 400, 'Owners cannot remove themselves')
      assert.equal((await remove(editor, viewer)).status, 403)
      assert.equal((await remove(owner, viewer)).status, 204)
      const untagged = await ok<{ courseId: string | null; lectureNumber: number | null }>(
        request(viewer, `/calculators/${calc.id}`),
      )
      assert.deepEqual([untagged.courseId, untagged.lectureNumber], [null, null])
      assert.deepEqual(await myCourses(viewer), [])
    })

    await t.test('deleting a course: owner only; calculators lose the tag', async () => {
      const calc = await api.createCalculator(editor, 'Orbit speed', { courseId: astro.id, lectureNumber: 1 })
      assert.equal((await request(editor, `/courses/${astro.id}`, { method: 'DELETE' })).status, 403)
      assert.equal((await request(owner, `/courses/${astro.id}`, { method: 'DELETE' })).status, 204)
      assert.equal((await request(editor, `/courses/${astro.id}/members`)).status, 404)
      const kept = await ok<{ courseId: string | null }>(request(editor, `/calculators/${calc.id}`))
      assert.equal(kept.courseId, null)
      assert.deepEqual(await myCourses(), [mission.id])
    })
  },
)
