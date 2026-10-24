import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const databaseUrl = process.env.NC_TEST_DATABASE_URL

test(
  'page, role, file indexing, move, and backup API workflows',
  { skip: !databaseUrl, timeout: 180_000 },
  async (t) => {
    if (!databaseUrl) return
    const testDatabase = new URL(databaseUrl)
    if (!testDatabase.pathname.endsWith('_test'))
      throw new Error('NC_TEST_DATABASE_URL must point to a dedicated database ending in _test')

    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'notecyclopedia-api-test-'))
    process.env.DATABASE_URL = databaseUrl
    process.env.BETTER_AUTH_SECRET = 'dedicated-integration-test-secret-at-least-32'
    process.env.BETTER_AUTH_URL = 'http://localhost:5173'
    process.env.WEB_ORIGIN = 'http://localhost:5173'
    process.env.UPLOAD_DIR = uploadDir

    const [{ migrate }, { pool, db, schema }, { createApp }, jobs] = await Promise.all([
      import('drizzle-orm/node-postgres/migrator'),
      import('../db'),
      import('../app'),
      import('../services/jobs'),
    ])
    const { eq, inArray } = await import('drizzle-orm')
    const { fileURLToPath } = await import('node:url')
    const here = path.dirname(fileURLToPath(import.meta.url))
    const state: {
      server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined
      ownerId: string | undefined
      extraUserIds: string[]
      jobsStarted: boolean
    } = { server: undefined, ownerId: undefined, extraUserIds: [], jobsStarted: false }

    t.after(async () => {
      if (state.server) {
        state.server.close()
        await once(state.server, 'close')
      }
      if (state.jobsStarted) await jobs.stopJobs()
      if (state.ownerId) await db.delete(schema.courses).where(eq(schema.courses.createdBy, state.ownerId))
      if (state.extraUserIds.length)
        await db.delete(schema.user).where(inArray(schema.user.id, state.extraUserIds))
      if (state.ownerId) await db.delete(schema.user).where(eq(schema.user.id, state.ownerId))
      await pool.end()
      await rm(uploadDir, { recursive: true, force: true })
    })

    await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
    await migrate(db, { migrationsFolder: path.resolve(here, '../../drizzle') })
    await jobs.startJobs()
    state.jobsStarted = true

    const app = createApp()
    state.server = app.listen(0, '127.0.0.1')
    await once(state.server, 'listening')
    const address = state.server.address()
    assert.ok(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const origin = 'http://localhost:5173'

    type Actor = { id: string; cookie: string; email: string }
    const signup = async (label: string): Promise<Actor> => {
      const email = `${label}-${crypto.randomUUID()}@example.test`
      const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ name: label, email, password: 'integration-test-password' }),
      })
      assert.ok(response.ok, `Sign-up failed: ${response.status} ${await response.text()}`)
      const cookies = response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';', 1)[0])
        .join('; ')
      assert.ok(cookies, 'Sign-up did not establish a session')
      const result = (await response.json()) as { user: { id: string } }
      return { id: result.user.id, cookie: cookies, email }
    }

    const request = async (actor: Actor, endpoint: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('cookie', actor.cookie)
      headers.set('origin', origin)
      if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json')
      return fetch(`${baseUrl}/api${endpoint}`, { ...init, headers })
    }
    const json = (body: unknown) => JSON.stringify(body)

    const owner = await signup('owner')
    state.ownerId = owner.id
    const editor = await signup('editor')
    const viewer = await signup('viewer')
    state.extraUserIds = [editor.id, viewer.id]

    const createCourse = async (name: string) => {
      const response = await request(owner, '/courses', { method: 'POST', body: json({ name }) })
      assert.equal(response.status, 201)
      return (await response.json()) as { id: string }
    }
    const sourceCourse = await createCourse('Source course')
    const targetCourse = await createCourse('Target course')

    for (const [actor, role] of [
      [editor, 'editor'],
      [viewer, 'viewer'],
    ] as const) {
      const response = await request(owner, `/courses/${sourceCourse.id}/members`, {
        method: 'POST',
        body: json({ email: actor.email, role }),
      })
      assert.equal(response.status, 201)
    }
    const addEditorToTarget = await request(owner, `/courses/${targetCourse.id}/members`, {
      method: 'POST',
      body: json({ email: editor.email, role: 'editor' }),
    })
    assert.equal(addEditorToTarget.status, 201)

    const uploadBody = new FormData()
    uploadBody.set('courseId', sourceCourse.id)
    uploadBody.append(
      'files',
      new Blob(['A source file for an indexed lecture.'], { type: 'text/plain' }),
      'source.txt',
    )
    const uploadResponse = await request(owner, '/files', { method: 'POST', body: uploadBody })
    assert.equal(uploadResponse.status, 201)
    const [uploaded] = (await uploadResponse.json()) as Array<{ id: string; pageId: string | null }>
    assert.ok(uploaded)
    assert.equal(uploaded.pageId, null)

    await assert.doesNotReject(async () => {
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        const response = await request(owner, `/files?courseId=${sourceCourse.id}`)
        const files = (await response.json()) as Array<{ id: string; status: string }>
        if (files.find((file) => file.id === uploaded.id)?.status === 'indexed') return
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error('Uploaded source was not indexed within 30 seconds')
    })

    const pageInput = {
      courseId: sourceCourse.id,
      sourceFileId: uploaded.id,
      title: 'Lecture one',
      type: 'lecture',
      lectureNumber: 1,
      tags: ['environment'],
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First draft' }] }],
      },
      aiVisible: true,
    }
    const createAsViewer = await request(viewer, '/pages', { method: 'POST', body: json(pageInput) })
    assert.equal(createAsViewer.status, 403)

    const createPage = await request(editor, '/pages', { method: 'POST', body: json(pageInput) })
    assert.equal(createPage.status, 201)
    const page = (await createPage.json()) as {
      id: string
      revision: number
      lectureNumber: number
      courseId: string
    }
    assert.equal(page.lectureNumber, 1)
    const sourceFiles = await request(viewer, `/files?courseId=${sourceCourse.id}&pageId=${page.id}`)
    assert.equal(sourceFiles.status, 200)
    const attached = (await sourceFiles.json()) as Array<{ id: string; pageId: string | null }>
    assert.equal(attached.find((file) => file.id === uploaded.id)?.pageId, page.id)

    const updatedInput = {
      ...pageInput,
      sourceFileId: undefined,
      title: 'Lecture one, revised',
      lectureNumber: 2,
      baseRevision: page.revision,
    }
    const updateAsViewer = await request(viewer, `/pages/${page.id}`, {
      method: 'PUT',
      body: json(updatedInput),
    })
    assert.equal(updateAsViewer.status, 403)
    const updatePage = await request(editor, `/pages/${page.id}`, {
      method: 'PUT',
      body: json(updatedInput),
    })
    assert.equal(updatePage.status, 200)
    const updated = (await updatePage.json()) as { revision: number; lectureNumber: number }
    assert.equal(updated.revision, 2)
    assert.equal(updated.lectureNumber, 2)

    const movePage = await request(editor, `/pages/${page.id}/move`, {
      method: 'POST',
      body: json({ courseId: targetCourse.id }),
    })
    assert.equal(movePage.status, 200)
    const moved = (await movePage.json()) as { courseId: string }
    assert.equal(moved.courseId, targetCourse.id)
    const movedFilesResponse = await request(editor, `/files?courseId=${targetCourse.id}&pageId=${page.id}`)
    const movedFiles = (await movedFilesResponse.json()) as Array<{ id: string }>
    assert.ok(movedFiles.some((file) => file.id === uploaded.id))

    const backup = await request(owner, '/backup/export')
    assert.equal(backup.status, 200)
    const archive = await backup.blob()
    const previewBody = new FormData()
    previewBody.set('archive', archive, 'backup.zip')
    const preview = await request(owner, '/backup/preview', { method: 'POST', body: previewBody })
    assert.equal(preview.status, 200)
    const previewSummary = (await preview.json()) as { pages: number; files: number }
    assert.ok(previewSummary.pages >= 1)
    assert.ok(previewSummary.files >= 1)

    const importBody = new FormData()
    importBody.set('archive', archive, 'backup.zip')
    const restored = await request(owner, '/backup/import', { method: 'POST', body: importBody })
    assert.equal(restored.status, 200)
    const restoredSummary = (await restored.json()) as { pages: number; files: number }
    assert.ok(restoredSummary.pages >= 1)
    assert.ok(restoredSummary.files >= 1)
  },
)
