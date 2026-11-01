import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parseEnv } from 'node:util'

const rootEnv = path.resolve(import.meta.dirname, '../../../../.env')
// Only the test database is read from .env; the dev database and API keys stay out of the test.
const databaseUrl =
  process.env.NC_TEST_DATABASE_URL ||
  (existsSync(rootEnv) ? parseEnv(readFileSync(rootEnv, 'utf8')).NC_TEST_DATABASE_URL : undefined)

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
    // Never call Claude from tests, even when a key is set in the shell.
    process.env.ANTHROPIC_API_KEY = ''

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
      if (!response.ok) throw new Error(`Sign-up failed: ${response.status} ${await response.text()}`)
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
    const [ownerRow] = await db
      .select({ timezone: schema.user.timezone })
      .from(schema.user)
      .where(eq(schema.user.id, owner.id))
    assert.equal(ownerRow?.timezone, 'Europe/Sofia', 'New accounts default to Eastern European Time')

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

    const createConstant = await request(editor, `/courses/${sourceCourse.id}/constants`, {
      method: 'POST',
      body: json({
        key: 'SOUND_SPEED',
        name: 'Speed of sound',
        symbol: 'c_s',
        value: 343,
        unit: 'm/s',
        description: 'Approximate value in dry air at 20 °C.',
      }),
    })
    assert.equal(createConstant.status, 201)
    const courseConstant = (await createConstant.json()) as { id: string; value: number }
    assert.equal(courseConstant.value, 343)
    const visibleConstants = await request(viewer, `/courses/${sourceCourse.id}/constants`)
    assert.equal(visibleConstants.status, 200)
    assert.equal(((await visibleConstants.json()) as Array<{ id: string }>)[0]?.id, courseConstant.id)
    const forbiddenConstant = await request(viewer, `/courses/${sourceCourse.id}/constants`, {
      method: 'POST',
      body: json({
        key: 'FORBIDDEN',
        name: 'Forbidden',
        symbol: 'f',
        value: 1,
        unit: 'm',
      }),
    })
    assert.equal(forbiddenConstant.status, 403)
    const updateConstant = await request(
      editor,
      `/courses/${sourceCourse.id}/constants/${courseConstant.id}`,
      {
        method: 'PUT',
        body: json({
          key: 'SOUND_SPEED',
          name: 'Speed of sound',
          symbol: 'c_s',
          value: 344,
          unit: 'm/s',
          description: 'Revised reference value.',
        }),
      },
    )
    assert.equal(updateConstant.status, 200)
    assert.equal(((await updateConstant.json()) as { value: number }).value, 344)

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

    type FormulaPage = { revision: number; content: { content: Array<{ attrs?: { id?: string } }> } }
    const saveFormula = async (baseRevision: number, formula: Record<string, unknown>) => {
      const response = await request(editor, `/pages/${page.id}`, {
        method: 'PUT',
        body: json({
          ...updatedInput,
          baseRevision,
          content: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Kepler orbit notes' }] },
              { type: 'formula', attrs: formula },
            ],
          },
        }),
      })
      assert.equal(response.status, 200)
      return (await response.json()) as FormulaPage
    }
    const indexedFormula = async () => {
      const response = await request(viewer, '/formulas')
      const rows = (await response.json()) as Array<{ id: string; pageId: string; latex: string }>
      return rows.filter((row) => row.pageId === page.id)
    }
    const withFormula = await saveFormula(updated.revision, { latex: 'T = 2\\pi\\sqrt{a^3/\\mu}' })
    const formulaId = withFormula.content.content[1]?.attrs?.id
    assert.ok(formulaId, 'Saving should assign the formula block an id')
    const [firstRow] = await indexedFormula()
    assert.ok(firstRow)
    const edited = await saveFormula(withFormula.revision, {
      id: formulaId,
      latex: 'T = 2\\pi\\sqrt{a^3/GM}',
    })
    assert.equal(edited.content.content[1]?.attrs?.id, formulaId)
    assert.deepEqual(
      (await indexedFormula()).map(({ id, latex }) => ({ id, latex })),
      [{ id: firstRow.id, latex: 'T = 2\\pi\\sqrt{a^3/GM}' }],
      'Editing a formula should keep its index row',
    )

    const restoreAsViewer = await request(
      viewer,
      `/pages/${page.id}/revisions/${withFormula.revision}/restore`,
      {
        method: 'POST',
        body: json({ baseRevision: edited.revision }),
      },
    )
    assert.equal(restoreAsViewer.status, 403)
    const missingRevision = await request(viewer, `/pages/${page.id}/revisions/latest`)
    assert.equal(missingRevision.status, 404)
    const restoreResponse = await request(
      editor,
      `/pages/${page.id}/revisions/${withFormula.revision}/restore`,
      {
        method: 'POST',
        body: json({ baseRevision: edited.revision }),
      },
    )
    assert.equal(restoreResponse.status, 200)
    const restoredPage = (await restoreResponse.json()) as FormulaPage
    assert.equal(restoredPage.revision, edited.revision + 1)
    assert.deepEqual(
      (await indexedFormula()).map(({ id, latex }) => ({ id, latex })),
      [{ id: firstRow.id, latex: 'T = 2\\pi\\sqrt{a^3/\\mu}' }],
      'Restoring should bring back the old formula in the same index row',
    )
    const staleRestore = await request(
      editor,
      `/pages/${page.id}/revisions/${withFormula.revision}/restore`,
      {
        method: 'POST',
        body: json({ baseRevision: edited.revision }),
      },
    )
    assert.equal(staleRestore.status, 409)

    // Widgets are validated on save; an image uploaded before it is placed gets linked to the page.
    const orbitSpec = {
      version: 1,
      name: 'Circular orbit',
      inputs: [
        { key: 'r', label: 'Radius', unit: 'km', default: 7000 },
        { key: 'mu', label: 'Gravitational parameter', unit: 'km3/s2', default: 398600 },
      ],
      outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / r)' }],
    }
    const imageUpload = new FormData()
    imageUpload.set('courseId', sourceCourse.id)
    imageUpload.append(
      'files',
      new Blob(
        [
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            'base64',
          ),
        ],
        {
          type: 'image/png',
        },
      ),
      'orbit.png',
    )
    const imageResponse = await request(editor, '/files', { method: 'POST', body: imageUpload })
    assert.equal(imageResponse.status, 201)
    const [image] = (await imageResponse.json()) as Array<{ id: string; pageId: string | null }>
    assert.ok(image)
    assert.equal(image.pageId, null)

    const saveBlocks = (baseRevision: number, blocks: unknown[]) =>
      request(editor, `/pages/${page.id}`, {
        method: 'PUT',
        body: json({
          ...updatedInput,
          baseRevision,
          content: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Kepler orbit notes' }] },
              ...blocks,
            ],
          },
        }),
      })
    const invalidWidget = await saveBlocks(restoredPage.revision, [
      {
        type: 'widget',
        attrs: { kind: 'plot', spec: orbitSpec, plot: { x: 'nope', y: ['v'], from: 1, to: 2 } },
      },
    ])
    assert.equal(invalidWidget.status, 400)
    assert.match(((await invalidWidget.json()) as { error: string }).error, /Unknown input "nope"/)
    const withBlocks = await saveBlocks(restoredPage.revision, [
      {
        type: 'widget',
        attrs: { kind: 'plot', spec: orbitSpec, plot: { x: 'r', y: ['v'], from: 6500, to: 42000 } },
      },
      { type: 'image', attrs: { fileId: image.id, caption: 'Orbit sketch' } },
    ])
    assert.equal(withBlocks.status, 200)
    const imageFiles = await request(editor, `/files?pageId=${page.id}`)
    assert.ok(
      ((await imageFiles.json()) as Array<{ id: string }>).some((file) => file.id === image.id),
      'Saving a page should link the files its image blocks show',
    )

    // Files are served by their extension's type, whatever the browser claimed at upload.
    const disguised = new FormData()
    disguised.set('courseId', sourceCourse.id)
    disguised.append('files', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'notes.txt')
    const disguisedResponse = await request(editor, '/files', { method: 'POST', body: disguised })
    assert.equal(disguisedResponse.status, 201)
    const [disguisedFile] = (await disguisedResponse.json()) as Array<{ id: string; mime: string }>
    assert.ok(disguisedFile)
    assert.equal(disguisedFile.mime, 'text/plain; charset=utf-8')
    const served = await request(viewer, `/files/${disguisedFile.id}/download?inline=1`)
    assert.equal(served.headers.get('content-type'), 'text/plain; charset=utf-8')
    const servedImage = await request(viewer, `/files/${image.id}/download?inline=1`)
    assert.equal(servedImage.headers.get('content-type'), 'image/png')
    assert.match(servedImage.headers.get('content-disposition') ?? '', /^inline/)

    await assert.doesNotReject(async () => {
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        const chunks = await db
          .select({ text: schema.chunks.text })
          .from(schema.chunks)
          .where(eq(schema.chunks.sourceId, page.id))
        // The latest save also has a plot widget, whose description is indexed with the text.
        if (
          chunks.some(
            (chunk) => chunk.text.includes('Kepler orbit notes') && chunk.text.includes('Plot of Speed'),
          )
        )
          return
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error('Saved page was not reindexed within 30 seconds')
    })

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
    assert.ok(
      movedFiles.some((file) => file.id === image.id),
      'An image shown on the page should move with it',
    )

    // Calculator exports: theory and steps in HTML and Python, formulas in Excel.
    const created = await request(editor, '/calculators', {
      method: 'POST',
      body: json({
        courseId: sourceCourse.id,
        spec: {
          version: 1,
          name: 'Circular orbit',
          theory: 'Gravity provides the centripetal force: μ/r² = v²/r.',
          inputs: [
            { key: 'r', label: 'Radius', unit: 'km', default: 7000 },
            { key: 'mu', label: 'Gravitational parameter', unit: 'km3/s2', default: 398600 },
          ],
          outputs: [
            {
              key: 'v',
              label: 'Speed',
              unit: 'km/s',
              expr: 'sqrt(mu / r)',
              explanation: 'Solve μ/r² = v²/r for v.',
            },
          ],
        },
      }),
    })
    assert.equal(created.status, 201)
    const calculator = (await created.json()) as { id: string }
    const exported = async (format: string) => {
      const response = await request(viewer, `/calculators/${calculator.id}/export?format=${format}`)
      assert.equal(response.status, 200, `export ${format}`)
      return response
    }
    const html = await (await exported('html')).text()
    assert.match(html, /<h2>Step-by-step solution<\/h2>/)
    assert.match(html, /Gravity provides the centripetal force/)
    assert.match(await (await exported('py')).text(), /# Solve μ\/r² = v²\/r for v\./)
    const xlsxResponse = await exported('xlsx')
    assert.equal(
      xlsxResponse.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    assert.match(xlsxResponse.headers.get('content-disposition') ?? '', /circular-orbit\.xlsx/)
    const { default: unzipper } = await import('unzipper')
    const workbook = await unzipper.Open.buffer(Buffer.from(await xlsxResponse.arrayBuffer()))
    const entry = (name: string) => workbook.files.find((f) => f.path === name)
    assert.ok(entry('[Content_Types].xml') && entry('xl/workbook.xml') && entry('xl/worksheets/sheet2.xml'))
    const sheet = (await entry('xl/worksheets/sheet1.xml')?.buffer())?.toString('utf8') ?? ''
    assert.match(sheet, /<f>SQRT\(\(\$B\$5\/\$B\$4\)\)<\/f><v>7\.54/)

    // The chat tools find course calculators by keyword, only for course members, and run them.
    const { calculatorLibrary } = await import('../services/calculator-library')
    const { runChatTool } = await import('../services/claude')
    const outsider = await signup('outsider')
    state.extraUserIds.push(outsider.id)
    const viewerLibrary = calculatorLibrary(viewer.id)
    const found = await viewerLibrary.find('circular speed')
    assert.deepEqual(
      found.map((c) => c.id),
      [calculator.id],
    )
    assert.deepEqual(await calculatorLibrary(outsider.id).find('circular speed'), [])
    assert.equal(await calculatorLibrary(outsider.id).get(calculator.id), null)
    const run = await runChatTool(
      'run_calculator',
      { calculatorId: calculator.id, inputs: [{ key: 'r', value: 42164 }] },
      viewerLibrary,
    )
    assert.match(
      run.content,
      /v = sqrt\(mu \/ r\) = sqrt\(\(398600 km3\/s2\) \/ \(42164 km\)\) = 3\.075 km\/s/,
    )
    assert.equal(run.widget?.kind, 'calculator')

    // A chat message needs text or a photo, and photos must be base64 images.
    const chat = (body: unknown) => request(viewer, '/ai/chat', { method: 'POST', body: json(body) })
    assert.equal((await chat({ mode: 'tutor', message: '' })).status, 400)
    assert.equal(
      (
        await chat({
          mode: 'check',
          message: '',
          attachments: [{ mediaType: 'image/jpeg', data: 'not base64!' }],
        })
      ).status,
      400,
    )
    assert.equal(
      (await chat({ mode: 'check', message: 'Is this right?' })).status,
      503,
      'No API key in tests',
    )

    const backup = await request(owner, '/backup/export')
    assert.equal(backup.status, 200)
    const archive = await backup.blob()
    const previewBody = new FormData()
    previewBody.set('archive', archive, 'backup.zip')
    const preview = await request(owner, '/backup/preview', { method: 'POST', body: previewBody })
    assert.equal(preview.status, 200)
    const previewSummary = (await preview.json()) as { pages: number; files: number; constants: number }
    assert.ok(previewSummary.pages >= 1)
    assert.ok(previewSummary.files >= 1)
    assert.equal(previewSummary.constants, 1)

    const importBody = new FormData()
    importBody.set('archive', archive, 'backup.zip')
    const restored = await request(owner, '/backup/import', { method: 'POST', body: importBody })
    assert.equal(restored.status, 200)
    const restoredSummary = (await restored.json()) as { pages: number; files: number; constants: number }
    assert.ok(restoredSummary.pages >= 1)
    assert.ok(restoredSummary.files >= 1)
    assert.equal(restoredSummary.constants, 1)
  },
)
