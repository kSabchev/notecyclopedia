import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { TestContext } from 'node:test'
import { migrateTestDatabase, useTestDatabase } from './database'

/** A signed-up user and their session cookie. */
export type Actor = { id: string; name: string; email: string; cookie: string }
export type Role = 'editor' | 'viewer'

/**
 * The API on the test database, for one integration test file: sign users up, call the API as them, and remove
 * everything they made when the test ends. Each test file runs in its own process, so files run in parallel.
 *
 * Background jobs are off unless `jobs` is set: page indexing then runs inline and uploads are not ingested. Only a
 * test that waits for uploads to be indexed needs them (one worker per process could otherwise pick up another
 * process's upload, whose file is in that process's upload folder).
 */
export async function startTestApi(
  t: TestContext,
  databaseUrl: string,
  opts: { jobs?: boolean; env?: Record<string, string> } = {},
) {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'notecyclopedia-api-test-'))
  useTestDatabase(databaseUrl, {
    UPLOAD_DIR: uploadDir,
    ...(opts.jobs ? {} : { NC_DISABLE_BACKGROUND_JOBS: 'true' }),
    ...opts.env,
  })
  await migrateTestDatabase()
  const [{ pool, db, schema }, { createApp }, jobs, orm] = await Promise.all([
    import('../db'),
    import('../app'),
    import('../services/jobs'),
    import('drizzle-orm'),
  ])
  const users: string[] = []
  const server = createApp().listen(0, '127.0.0.1')

  t.after(async () => {
    server.close()
    await once(server, 'close')
    await jobs.stopJobs()
    if (users.length) {
      const { inArray } = orm
      await db.delete(schema.courses).where(inArray(schema.courses.createdBy, users))
      // Calculators are personal and outlive courses.
      await db.delete(schema.calculators).where(inArray(schema.calculators.ownerId, users))
      await db.delete(schema.user).where(inArray(schema.user.id, users))
    }
    await pool.end()
    await rm(uploadDir, { recursive: true, force: true })
  })

  await once(server, 'listening')
  await jobs.startJobs()
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const origin = 'http://localhost:5173'

  async function signup(name: string): Promise<Actor> {
    const email = `${name}-${crypto.randomUUID()}@example.test`
    const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ name, email, password: 'integration-test-password' }),
    })
    if (!response.ok) throw new Error(`Sign-up failed: ${response.status} ${await response.text()}`)
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(';', 1)[0])
      .join('; ')
    assert.ok(cookie, 'Sign-up did not establish a session')
    const { user } = (await response.json()) as { user: { id: string } }
    users.push(user.id)
    return { id: user.id, name, email, cookie }
  }

  /** Calls `/api{endpoint}` as `actor`; a string body is sent as JSON. */
  function request(actor: Actor, endpoint: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    headers.set('cookie', actor.cookie)
    headers.set('origin', origin)
    if (init.body && !(init.body instanceof FormData) && !headers.has('content-type'))
      headers.set('content-type', 'application/json')
    return fetch(`${baseUrl}/api${endpoint}`, { ...init, headers })
  }
  const json = (body: unknown) => JSON.stringify(body)
  /** POST, PUT or PATCH a JSON body. */
  const send = (actor: Actor, method: string, endpoint: string, body?: unknown) =>
    request(actor, endpoint, { method, ...(body === undefined ? {} : { body: json(body) }) })
  /** The response's JSON, after checking its status. */
  async function ok<T>(response: Response | Promise<Response>, status = 200): Promise<T> {
    const r = await response
    assert.equal(
      r.status,
      status,
      `${r.url}: ${r.status} ${r.status === status ? '' : await r.clone().text()}`,
    )
    return (await r.json()) as T
  }

  async function createCourse(actor: Actor, name: string) {
    return ok<{ id: string; name: string; role: string }>(send(actor, 'POST', '/courses', { name }), 201)
  }
  async function addMember(owner: Actor, courseId: string, member: Actor, role: Role) {
    await ok(send(owner, 'POST', `/courses/${courseId}/members`, { email: member.email, role }), 201)
  }
  /** A course of `owner`'s with the given members. */
  async function courseWith(owner: Actor, name: string, members: [Actor, Role][] = []) {
    const course = await createCourse(owner, name)
    for (const [member, role] of members) await addMember(owner, course.id, member, role)
    return course
  }

  type PageBody = { courseId: string; title: string; type?: string; content?: unknown[] } & Record<
    string,
    unknown
  >
  type Page = {
    id: string
    revision: number
    courseId: string
    lectureNumber: number | null
    content: { type: 'doc'; content: { type: string; attrs?: { id?: string } }[] }
  }
  async function createPage(actor: Actor, { content = [], type = 'lecture', ...body }: PageBody) {
    return ok<Page>(send(actor, 'POST', '/pages', { type, ...body, content: { type: 'doc', content } }), 201)
  }

  /** Uploads files to a course; `fields` adds form fields such as lectureNumber. */
  function upload(
    actor: Actor,
    courseId: string,
    files: { name: string; body: string | Buffer; type?: string }[],
    fields: Record<string, string> = {},
  ) {
    const form = new FormData()
    form.set('courseId', courseId)
    for (const [k, v] of Object.entries(fields)) form.set(k, v)
    for (const f of files)
      form.append(
        'files',
        new Blob([typeof f.body === 'string' ? f.body : new Uint8Array(f.body)], {
          type: f.type ?? 'text/plain',
        }),
        f.name,
      )
    return request(actor, '/files', { method: 'POST', body: form })
  }

  /** A personal calculator (tagged with a course when `courseId` is given). */
  async function createCalculator(actor: Actor, name: string, extra: Record<string, unknown> = {}) {
    return ok<{
      id: string
      name: string
      courseId: string | null
      lectureNumber: number | null
      spec: unknown
    }>(
      send(actor, 'POST', '/calculators', {
        spec: {
          version: 1,
          name,
          inputs: [{ key: 'r', label: 'Radius', unit: 'km', default: 7000 }],
          outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(398600 / r)' }],
        },
        ...extra,
      }),
      201,
    )
  }

  /** Polls until `check` returns true, for work done in the background. */
  async function waitFor(what: string, check: () => Promise<boolean>, ms = 30_000) {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`${what} did not happen within ${ms / 1000} s`)
  }

  return {
    db,
    schema,
    orm,
    baseUrl,
    signup,
    request,
    send,
    ok,
    json,
    createCourse,
    addMember,
    courseWith,
    createPage,
    upload,
    createCalculator,
    waitFor,
  }
}

export type TestApi = Awaited<ReturnType<typeof startTestApi>>
