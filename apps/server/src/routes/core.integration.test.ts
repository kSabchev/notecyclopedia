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
    const { and, eq, inArray } = await import('drizzle-orm')
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
      // Calculators are personal and outlive courses: remove the test users' own.
      const testUsers = [...state.extraUserIds, ...(state.ownerId ? [state.ownerId] : [])]
      if (testUsers.length)
        await db.delete(schema.calculators).where(inArray(schema.calculators.ownerId, testUsers))
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
    // A malformed body is the client's error, not a server failure.
    const malformed = await request(owner, '/courses', {
      method: 'POST',
      body: '{"name":',
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(malformed.status, 400)
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
    // Calculators are personal: a member of the course it is tagged with cannot open it.
    assert.equal((await request(viewer, `/calculators/${calculator.id}`)).status, 404)
    assert.ok(
      !((await (await request(viewer, '/calculators')).json()) as { id: string }[]).some(
        (c) => c.id === calculator.id,
      ),
    )
    const exported = async (format: string) => {
      const response = await request(editor, `/calculators/${calculator.id}/export?format=${format}`)
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

    // The chat tools find your own calculators by keyword (not a classmate's), and run them.
    const { calculatorLibrary } = await import('../services/calculator-library')
    const { runChatTool } = await import('../services/claude')
    const outsider = await signup('outsider')
    state.extraUserIds.push(outsider.id)
    const editorLibrary = calculatorLibrary(editor.id)
    const found = await editorLibrary.find('circular speed')
    assert.deepEqual(
      found.map((c) => c.id),
      [calculator.id],
    )
    assert.deepEqual(await calculatorLibrary(viewer.id).find('circular speed'), [], 'Not a classmate’s')
    assert.deepEqual(await calculatorLibrary(outsider.id).find('circular speed'), [])
    assert.equal(await calculatorLibrary(outsider.id).get(calculator.id), null)
    const run = await runChatTool(
      'run_calculator',
      { calculatorId: calculator.id, inputs: [{ key: 'r', value: 42164 }] },
      editorLibrary,
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

    // Headings become terms: searchable, and other pages can reference them.
    const newPage = async (title: string, type: string, content: unknown[]) => {
      const response = await request(owner, '/pages', {
        method: 'POST',
        body: json({ courseId: sourceCourse.id, title, type, content: { type: 'doc', content } }),
      })
      assert.equal(response.status, 201)
      return (await response.json()) as { id: string; content: { content: { attrs?: { id?: string } }[] } }
    }
    const lecture = await newPage('Orbital transfers', 'lecture', [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hohmann transfer' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Two burns between circular orbits.' }] },
    ])
    const headingId = lecture.content.content[0]?.attrs?.id
    assert.ok(headingId, 'The server gives headings an id')
    const hub = await newPage('Transfers (topic hub)', 'theory', [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          {
            type: 'text',
            text: 'Hohmann transfer',
            marks: [{ type: 'link', attrs: { href: `/pages/${lecture.id}#${headingId}` } }],
          },
          {
            type: 'text',
            text: ' (gone)',
            marks: [{ type: 'link', attrs: { href: `/pages/${crypto.randomUUID()}` } }],
          },
        ],
      },
    ])
    const hits = (await (await request(viewer, '/search?q=hohmann')).json()) as Array<{
      kind: string
      id: string
      anchor: string | null
      snippet: string
    }>
    assert.deepEqual(hits[0], {
      kind: 'term',
      id: lecture.id,
      title: 'Hohmann transfer',
      courseId: sourceCourse.id,
      snippet: 'Orbital transfers',
      anchor: headingId,
    })
    const referencedBy = await (await request(viewer, `/pages/${lecture.id}/references`)).json()
    assert.deepEqual(referencedBy, [
      {
        sourcePageId: hub.id,
        sourceTitle: 'Transfers (topic hub)',
        sourceType: 'theory',
        targetNodeId: headingId,
      },
    ])
    assert.equal((await request(outsider, `/pages/${lecture.id}/references`)).status, 404)

    // Formula cards: the same formula elsewhere (spacing ignored), and calculators made from its page.
    const formulaPage = async (title: string, latex: string) =>
      (await newPage(title, 'lecture', [{ type: 'formula', attrs: { latex } }])) as unknown as {
        id: string
        content: { content: { attrs?: { id?: string } }[] }
      }
    const visViva = await formulaPage('Vis-viva', 'v^2 = \\mu \\left(\\frac{2}{r} - \\frac{1}{a}\\right)')
    const sameFormula = await formulaPage('Energy', 'v^2=\\mu\\left(\\frac{2}{r}-\\frac{1}{a}\\right)')
    await formulaPage('Unrelated', 'E = mc^2')
    const visVivaNode = visViva.content.content[0]?.attrs?.id as string

    // Pins are personal: each member pins for themselves (viewers too), and the page does not change.
    const pin = (actor: Actor, nodeId = visVivaNode) =>
      request(actor, '/formulas/pins', { method: 'POST', body: json({ pageId: visViva.id, nodeId }) })
    const unpin = (actor: Actor) =>
      request(actor, `/formulas/pins?pageId=${visViva.id}&nodeId=${visVivaNode}`, { method: 'DELETE' })
    const pinnedOf = async (actor: Actor) =>
      ((await (await request(actor, '/formulas?pinned=1')).json()) as { pageId: string; nodeId: string }[])
        .filter((f) => f.pageId === visViva.id)
        .map((f) => f.nodeId)
    assert.equal((await pin(owner)).status, 204)
    assert.equal((await pin(owner)).status, 204, 'Pinning twice is harmless')
    assert.deepEqual(await pinnedOf(owner), [visVivaNode])
    assert.deepEqual(await pinnedOf(viewer), [], "Another member's pins are not yours")
    assert.equal((await pin(viewer)).status, 204, 'Viewers can pin for themselves')
    assert.deepEqual(await pinnedOf(viewer), [visVivaNode])
    const allFormulas = (await (await request(owner, '/formulas')).json()) as {
      nodeId: string
      pinned: boolean
    }[]
    assert.equal(allFormulas.find((f) => f.nodeId === visVivaNode)?.pinned, true)
    assert.equal((await pin(outsider)).status, 404)
    assert.equal((await pin(owner, 'no-such-formula')).status, 404)
    const afterPins = (await (await request(owner, `/pages/${visViva.id}`)).json()) as { revision: number }
    assert.equal(afterPins.revision, 1, 'Pinning does not change the page')
    assert.equal((await unpin(owner)).status, 204)
    assert.deepEqual(await pinnedOf(owner), [])
    assert.deepEqual(await pinnedOf(viewer), [visVivaNode], "Unpinning leaves others' pins alone")
    const pageCalc = (actor: Actor, courseId: string | null, name: string) =>
      request(actor, '/calculators', {
        method: 'POST',
        body: json({
          courseId,
          sourcePageId: visViva.id,
          spec: {
            version: 1,
            name,
            inputs: [{ key: 'r', label: 'Radius', default: 7000 }],
            outputs: [{ key: 'v', label: 'Speed', expr: 'sqrt(398600 / r)' }],
          },
        }),
      })
    assert.equal((await pageCalc(owner, sourceCourse.id, 'Vis-viva speed')).status, 201)
    // A classmate's personal calculator from the same page is theirs alone.
    const personal = await pageCalc(editor, null, 'Editor personal calculator')
    assert.equal(personal.status, 201)
    const personalId = ((await personal.json()) as { id: string }).id
    const related = (await (
      await request(owner, `/formulas/related?pageId=${visViva.id}&nodeId=${visVivaNode}`)
    ).json()) as { elsewhere: { pageId: string; pageTitle: string }[]; calculators: { name: string }[] }
    assert.deepEqual(
      related.elsewhere.map((f) => [f.pageId, f.pageTitle]),
      [[sameFormula.id, 'Energy']],
    )
    assert.deepEqual(
      related.calculators.map((c) => c.name),
      ['Vis-viva speed'],
    )
    assert.equal(
      (await request(outsider, `/formulas/related?pageId=${visViva.id}&nodeId=${visVivaNode}`)).status,
      404,
    )
    // Personal calculators are not removed with courses; clean up so the test user can be deleted.
    assert.equal((await request(editor, `/calculators/${personalId}`, { method: 'DELETE' })).status, 204)

    // A topic hub may link to the course's matching sections and lectures, but not to other hubs.
    const { hubTargets } = await import('../services/topic-hub')
    const targets = await hubTargets(sourceCourse.id, 'Hohmann transfer')
    assert.deepEqual(
      targets.map((t) => [t.pageId, t.nodeId]),
      [
        [lecture.id, headingId],
        [lecture.id, null],
      ],
    )
    const draftHub = (body: unknown, actor = owner) =>
      request(actor, '/ai/topic-hub', { method: 'POST', body: json(body) })
    assert.equal((await draftHub({ courseId: sourceCourse.id, topic: 'Hohmann' }, viewer)).status, 403)
    assert.equal(
      (await draftHub({ courseId: sourceCourse.id, topic: 'Hohmann' })).status,
      503,
      'No API key in tests',
    )

    // The daily question: made on request, once a day, about a topic of the user's lectures.
    const dailyService = await import('../services/daily-question')
    const { day, question: none } = (await (await request(owner, '/daily/today')).json()) as {
      day: string
      question: unknown
    }
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(none, null)
    let claudeCalls = 0
    const prompts: string[] = []
    const fakeClaude = (async (
      request: { tools?: { name: string }[]; messages: { content: unknown }[] },
      opts: { meter?: { add: (model: string, usage: object) => void } },
    ) => {
      claudeCalls++
      prompts.push(String(request.messages[0]?.content))
      const tool = request.tools?.[0]?.name
      // As the real client does: count the call towards the question's cost.
      opts.meter?.add('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 })
      return {
        model: 'claude-sonnet-5-5',
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: `call_${claudeCalls}`,
            name: tool,
            input:
              tool === 'tell_story'
                ? { story: 'Apollo crews used transfer orbits on the way to the Moon.' }
                : {
                    question: 'Why does a Hohmann transfer need two burns?',
                    answer: 'One to leave, one to arrive.',
                  },
          },
        ],
        usage: { input_tokens: 1000, output_tokens: 100 },
      }
    }) as unknown as Parameters<typeof dailyService.generateDailyQuestion>[3]
    const made = await dailyService.generateDailyQuestion(
      owner.id,
      day,
      { courseId: sourceCourse.id },
      fakeClaude,
    )
    assert.equal(made.courseId, sourceCourse.id)
    // The language is decided from the notes and stated, not left for the model to guess.
    assert.match(prompts[0] ?? '', /Write everything in English./)
    assert.equal(made.question, 'Why does a Hohmann transfer need two burns?')
    assert.ok(made.usage && made.usage.inputTokens === 1000)
    const again = await dailyService.generateDailyQuestion(owner.id, day, {}, fakeClaude)
    assert.equal(again.id, made.id)
    assert.equal(claudeCalls, 1, 'One question a day: the second request does not call Claude')
    assert.equal(
      ((await (await request(owner, '/daily/today')).json()) as { question: { id: string } }).question.id,
      made.id,
    )
    const expanded = await dailyService.expandDailyQuestion(made, 'story', owner.id, 'en', fakeClaude)
    assert.match(expanded.expansions.story ?? '', /Apollo/)
    assert.equal(expanded.usage?.inputTokens, 2000)
    // A stored expansion is returned without calling Claude (there is no API key here).
    const storyAgain = await request(owner, `/daily/${made.id}/expand`, {
      method: 'POST',
      body: json({ kind: 'story' }),
    })
    assert.equal(storyAgain.status, 200)
    assert.equal(
      (await request(outsider, `/daily/${made.id}/expand`, { method: 'POST', body: json({ kind: 'story' }) }))
        .status,
      404,
    )
    // Saving appends the question to its page as a new revision.
    const labels = { question: 'Question', answer: 'Answer', story: 'Story', advanced: 'Harder question' }
    const saved = await request(owner, `/daily/${made.id}/save`, { method: 'POST', body: json({ labels }) })
    assert.equal(saved.status, 200)
    const target = (await (await request(owner, `/pages/${made.pageId}`)).json()) as {
      content: { content: { type: string; content?: { text?: string }[] }[] }
    }
    assert.ok(
      target.content.content.some(
        (b) => b.type === 'heading' && b.content?.[0]?.text === `Question: ${made.topic}`,
      ),
    )
    // A question on demand is made in addition to today's, and avoids repeating it: another topic, or, when the
    // topic comes up again, Claude is shown the earlier question to ask something different.
    const extra = await dailyService.generateDailyQuestion(owner.id, day, { onDemand: true }, fakeClaude)
    assert.notEqual(extra.id, made.id)
    assert.ok(
      extra.topic !== made.topic || (prompts.at(-1) ?? '').includes(made.question),
      'A repeated topic shows Claude the earlier question',
    )
    assert.equal(
      ((await (await request(owner, '/daily/today')).json()) as { question: { id: string } }).question.id,
      made.id,
      "The first question of the day stays today's question",
    )
    const listed = (await (await request(owner, '/daily')).json()) as { id: string }[]
    assert.deepEqual(
      listed.map((q) => q.id),
      [extra.id, made.id],
    )
    assert.deepEqual(await (await request(owner, '/daily?q=no-such-question')).json(), [])
    assert.equal(((await (await request(owner, '/daily?q=two%20burns')).json()) as unknown[]).length, 2)
    assert.equal(
      (await request(viewer, '/daily/today', { method: 'POST', body: json({}) })).status,
      503,
      'No API key in tests',
    )
    assert.equal((await request(viewer, '/daily', { method: 'POST', body: json({}) })).status, 503)

    // Where was I: pages you opened and the pages your questions were answered from, from your own activity.
    assert.equal((await request(owner, `/pages/${visViva.id}/visit`, { method: 'POST' })).status, 204)
    assert.equal((await request(owner, `/pages/${lecture.id}/visit`, { method: 'POST' })).status, 204)
    assert.equal((await request(outsider, `/pages/${lecture.id}/visit`, { method: 'POST' })).status, 404)
    const [thread] = await db
      .insert(schema.aiThreads)
      .values({ userId: owner.id, title: 'Why two burns?', mode: 'tutor' })
      .returning()
    assert.ok(thread)
    const [, tutorAnswer] = await db
      .insert(schema.aiMessages)
      .values([
        {
          threadId: thread.id,
          role: 'user',
          content: 'Why two burns?',
          createdAt: new Date(Date.now() - 1000),
        },
        {
          threadId: thread.id,
          role: 'assistant',
          content: 'One burn leaves the orbit, the second circularises.',
          citations: [{ sourceType: 'page', sourceId: lecture.id, title: lecture.id }],
        },
      ])
      .returning()
    assert.ok(tutorAnswer)
    const where = (await (await request(owner, '/study/where')).json()) as {
      viewed: { id: string }[]
      threads: { id: string; mode: string }[]
      topics: { pageId: string; title: string; questions: number }[]
    }
    assert.deepEqual(
      where.viewed.slice(0, 2).map((v) => v.id),
      [lecture.id, visViva.id],
      'Most recently opened first',
    )
    assert.deepEqual(where.threads[0], { ...where.threads[0], id: thread.id, mode: 'tutor' })
    assert.deepEqual(
      where.topics.map((tp) => [tp.pageId, tp.title, tp.questions]),
      [[lecture.id, 'Orbital transfers', 1]],
    )
    const outsiderWhere = (await (await request(outsider, '/study/where')).json()) as { viewed: unknown[] }
    assert.deepEqual(outsiderWhere.viewed, [])

    // Quick check: kept with the answer, so a second request costs nothing; only for your own answers.
    const kept = {
      questions: [{ question: 'Why not one burn?', answer: 'One burn returns to the start.' }],
      usage: null,
    }
    await db
      .update(schema.aiMessages)
      .set({ quickCheck: kept })
      .where(eq(schema.aiMessages.id, tutorAnswer.id))
    const quick = await request(owner, `/ai/messages/${tutorAnswer.id}/quick-check`, {
      method: 'POST',
      body: json({}),
    })
    assert.equal(quick.status, 200)
    assert.deepEqual(await quick.json(), kept)
    assert.equal(
      (
        await request(outsider, `/ai/messages/${tutorAnswer.id}/quick-check`, {
          method: 'POST',
          body: json({}),
        })
      ).status,
      404,
    )

    // Exam prep: one call proposes the plan; dates and page links are made in code, then the plan is planEdit.
    const study = await import('../services/study')
    let planPrompt = ''
    const fakePlan = (async (request: { messages: { content: unknown }[] }) => {
      planPrompt = JSON.stringify(request.messages)
      return {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'plan',
            name: 'propose_revision_plan',
            input: {
              title: 'Transfers exam',
              days: [
                { day: 1, items: [{ ref: 'P1', focus: 'Read the lecture' }] },
                { day: 2, items: [{ ref: null, focus: 'Practice run' }] },
              ],
            },
          },
        ],
      }
    }) as unknown as Parameters<typeof study.generateExamPlan>[1]
    await assert.rejects(
      study.generateExamPlan(
        {
          userId: owner.id,
          courseId: sourceCourse.id,
          courseName: 'Source course',
          examDate: '2026-11-06',
          today: '2026-11-06',
          minutesPerDay: 60,
        },
        fakePlan,
      ),
      /between tomorrow/,
    )
    const plan = await study.generateExamPlan(
      {
        userId: owner.id,
        courseId: sourceCourse.id,
        courseName: 'Source course',
        examDate: '2026-11-09',
        today: '2026-11-06',
        minutesPerDay: 45,
      },
      fakePlan,
    )
    assert.match(planPrompt, /Day 3: Sun 2026-11-08/)
    assert.match(planPrompt, /P1: /)
    assert.deepEqual(
      plan.days.map((d) => [d.date, d.items.map((i) => i.focus)]),
      [
        ['2026-11-06', ['Read the lecture']],
        ['2026-11-07', ['Practice run']],
      ],
    )
    const firstPage = plan.days[0]?.items[0]
    assert.ok(firstPage?.pageId && firstPage.pageTitle)
    assert.deepEqual(plan.studyWeekdays, [0, 1, 2, 3, 4, 5, 6])

    // Weekdays only, and the exam's scope: just the lecture, marked shaky. Day numbers map to study days.
    const scoped = await study.generateExamPlan(
      {
        userId: owner.id,
        courseId: sourceCourse.id,
        courseName: 'Source course',
        examDate: '2026-11-12',
        today: '2026-11-06',
        minutesPerDay: 60,
        weekdays: [5, 1, 2, 3, 4],
        pages: [{ id: lecture.id, confidence: 'shaky' }],
      },
      fakePlan,
    )
    assert.match(planPrompt, /Day 1: Fri 2026-11-06.*Day 2: Mon 2026-11-09/)
    assert.ok(!planPrompt.includes('2026-11-07'), 'The weekend is not offered')
    assert.match(planPrompt, /P1: .*Orbital transfers.*student: shaky/)
    assert.ok(!planPrompt.includes('P2: '), 'Only the pages in scope are listed')
    assert.deepEqual(scoped.studyWeekdays, [1, 2, 3, 4, 5])
    assert.deepEqual(
      scoped.days.map((d) => d.date),
      ['2026-11-06', '2026-11-09'],
    )
    assert.equal(scoped.days[0]?.items[0]?.pageId, lecture.id)

    // Today's tasks for the home page, and ticking one off on its own.
    assert.deepEqual(
      (await study.todaysTasks(owner.id, '2026-11-09')).map((p) => [
        p.planId,
        p.items.map((i) => i.focus),
        p.overdue,
      ]),
      [
        [plan.id, [], 2],
        [scoped.id, ['Practice run'], 1],
      ],
    )
    const scopedTask = scoped.days[1]?.items[0]
    assert.ok(scopedTask)
    const ticked = await request(owner, `/study/plans/${scoped.id}/items/${scopedTask.id}`, {
      method: 'PATCH',
      body: json({ done: true }),
    })
    assert.equal(ticked.status, 200)
    assert.equal(((await ticked.json()) as typeof scoped).days[1]?.items[0]?.done, true)
    assert.equal(
      (
        await request(viewer, `/study/plans/${scoped.id}/items/${scopedTask.id}`, {
          method: 'PATCH',
          body: json({ done: false }),
        })
      ).status,
      404,
    )
    const todayResponse = await request(owner, '/study/today')
    assert.equal(todayResponse.status, 200)
    assert.match(((await todayResponse.json()) as { today: string }).today, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal((await request(owner, `/study/plans/${scoped.id}`, { method: 'DELETE' })).status, 204)

    // Pause and resume: a paused plan is kept, but left out of today's revision.
    const paused = await request(owner, `/study/plans/${plan.id}`, {
      method: 'PATCH',
      body: json({ active: false }),
    })
    assert.equal(((await paused.json()) as typeof plan).active, false)
    assert.deepEqual(await study.todaysTasks(owner.id, '2026-11-07'), [])
    assert.equal(
      (await request(viewer, `/study/plans/${plan.id}`, { method: 'PATCH', body: json({ active: true }) }))
        .status,
      404,
    )
    await request(owner, `/study/plans/${plan.id}`, { method: 'PATCH', body: json({ active: true }) })

    // Export, then import: into the same course the page links come back; elsewhere tasks keep the page title.
    const planExport = await request(owner, `/study/plans/${plan.id}/export`)
    assert.equal(planExport.status, 200)
    assert.match(
      planExport.headers.get('content-disposition') ?? '',
      /attachment; filename="Transfers-exam\.plan\.json"/,
    )
    const planFile = (await planExport.json()) as { format: string; courseName: string }
    assert.equal(planFile.format, 'notecyclopedia-exam-plan')
    assert.equal(planFile.courseName, 'Source course')
    const importInto = async (courseId: string, actor = owner) =>
      request(actor, '/study/plans/import', { method: 'POST', body: json({ courseId, plan: planFile }) })
    const sameCourse = (await (await importInto(sourceCourse.id)).json()) as {
      plan: typeof plan
      linked: number
      unlinked: number
    }
    assert.deepEqual([sameCourse.linked, sameCourse.unlinked], [1, 0])
    assert.equal(sameCourse.plan.days[0]?.items[0]?.pageId, firstPage.pageId)
    const otherCourse = (await (await importInto(targetCourse.id)).json()) as typeof sameCourse
    assert.deepEqual([otherCourse.linked, otherCourse.unlinked], [0, 1])
    assert.equal(otherCourse.plan.days[0]?.items[0]?.pageTitle, firstPage.pageTitle)
    assert.equal((await importInto(sourceCourse.id, outsider)).status, 404, 'Only into your own courses')
    assert.equal(
      (
        await request(owner, '/study/plans/import', {
          method: 'POST',
          body: json({ courseId: sourceCourse.id, plan: { ...planFile, format: 'other' } }),
        })
      ).status,
      400,
    )

    // Share a copy with a member of the course; it becomes theirs only when they accept it.
    const shareWith = (userId: string) =>
      request(owner, `/study/plans/${plan.id}/share`, { method: 'POST', body: json({ userId }) })
    assert.equal((await shareWith(outsider.id)).status, 404, 'Only members of the course')
    assert.equal((await shareWith(owner.id)).status, 400)
    assert.equal((await shareWith(viewer.id)).status, 201)
    const incoming = (await (await request(viewer, '/study/shares')).json()) as {
      id: string
      fromName: string
      title: string
      tasks: number
    }[]
    assert.deepEqual(
      incoming.map((sh) => [sh.fromName, sh.title, sh.tasks]),
      [['owner', 'Transfers exam', 2]],
    )
    assert.deepEqual(await (await request(outsider, '/study/shares')).json(), [])
    const shareId = incoming[0]?.id as string
    assert.equal((await request(outsider, `/study/shares/${shareId}/accept`, { method: 'POST' })).status, 404)
    const accepted = await request(viewer, `/study/shares/${shareId}/accept`, { method: 'POST' })
    assert.equal(accepted.status, 201)
    const viewerPlan = (await accepted.json()) as typeof plan
    assert.equal(viewerPlan.courseId, sourceCourse.id)
    assert.equal(viewerPlan.days[0]?.items[0]?.pageId, firstPage.pageId)
    assert.ok(
      viewerPlan.days.every((d) => d.items.every((i) => !i.done)),
      'Progress is not shared',
    )
    assert.deepEqual(await (await request(viewer, '/study/shares')).json(), [])
    assert.equal((await request(owner, `/study/plans/${viewerPlan.id}`)).status, 404, 'The copy is private')
    // Declining removes the copy.
    await shareWith(viewer.id)
    const shareAgain = (await (await request(viewer, '/study/shares')).json()) as { id: string }[]
    assert.equal(
      (await request(viewer, `/study/shares/${shareAgain[0]?.id}`, { method: 'DELETE' })).status,
      204,
    )
    assert.deepEqual(await (await request(viewer, '/study/shares')).json(), [])

    const plansListed = (await (await request(owner, '/study/plans')).json()) as { id: string }[]
    assert.ok(plansListed.some((p) => p.id === plan.id))
    assert.equal((await request(viewer, `/study/plans/${plan.id}`)).status, 404, 'Plans are private')

    // Edit: tick an item, move one to another day; a link to a page outside the course is dropped.
    const foreign = (await (
      await request(owner, '/pages', {
        method: 'POST',
        body: json({ courseId: targetCourse.id, title: 'Elsewhere', type: 'lecture' }),
      })
    ).json()) as { id: string }
    const planEdit = await request(owner, `/study/plans/${plan.id}`, {
      method: 'PUT',
      body: json({
        title: 'Transfers exam (planEdit)',
        examDate: '2026-11-09',
        days: [
          { date: '2026-11-08', items: [{ ...firstPage, done: true }] },
          {
            date: '2026-11-07',
            items: [
              ...(plan.days[1]?.items ?? []),
              {
                id: crypto.randomUUID(),
                pageId: foreign.id,
                pageTitle: 'Elsewhere',
                focus: 'Sneak in',
                done: false,
              },
            ],
          },
        ],
      }),
    })
    assert.equal(planEdit.status, 200)
    const planSaved = (await planEdit.json()) as typeof plan
    assert.deepEqual(
      planSaved.days.map((d) => [d.date, d.items.map((i) => [i.focus, i.done, i.pageId === null])]),
      [
        [
          '2026-11-07',
          [
            ['Practice run', false, true],
            ['Sneak in', false, true],
          ],
        ],
        ['2026-11-08', [['Read the lecture', true, false]]],
      ],
    )
    assert.equal(
      (await request(viewer, `/study/plans/${plan.id}`, { method: 'PUT', body: json({ ...planSaved }) }))
        .status,
      404,
    )
    assert.equal((await request(owner, `/study/plans/${plan.id}`, { method: 'DELETE' })).status, 204)

    // Original lectures: an upload can be the original of lecture N of its course (one per lecture).
    const uploadOriginal = (n: number | null, names = ['slides-3.txt']) => {
      const body = new FormData()
      body.set('courseId', sourceCourse.id)
      if (n !== null) body.set('lectureNumber', String(n))
      for (const name of names)
        body.append('files', new Blob(['Lecture slides.'], { type: 'text/plain' }), name)
      return request(owner, '/files', { method: 'POST', body })
    }
    const original = await uploadOriginal(3)
    assert.equal(original.status, 201)
    const [slides] = (await original.json()) as { id: string; lectureNumber: number | null }[]
    assert.equal(slides?.lectureNumber, 3)
    assert.equal((await uploadOriginal(3, ['other.txt'])).status, 409, 'One original per lecture')
    assert.equal(
      (await uploadOriginal(4, ['a.txt', 'b.txt'])).status,
      400,
      'An original is uploaded on its own',
    )
    const plain = ((await (await uploadOriginal(null, ['handout.txt'])).json()) as { id: string }[])[0]
    const markLecture = (actor: Actor, id: string, lectureNumber: number | null) =>
      request(actor, `/files/${id}/lecture`, { method: 'PATCH', body: json({ lectureNumber }) })
    const takenLecture = await markLecture(owner, plain?.id as string, 3)
    assert.equal(takenLecture.status, 409)
    assert.match(
      ((await takenLecture.json()) as { error: string }).error,
      /^Lecture 3 of Source course already has an original \(slides-3\.txt\)\./,
      'The message names the course and the file holding the lecture',
    )
    // Lecture numbers are per course: the same file can be lecture 3 of another course, and moves there.
    const toCourse = (courseId: string, lectureNumber: number | null) =>
      request(owner, `/files/${plain?.id}/lecture`, {
        method: 'PATCH',
        body: json({ lectureNumber, courseId }),
      })
    const movedOriginal = (await (await toCourse(targetCourse.id, 3)).json()) as {
      courseId: string
      pageId: string | null
      lectureNumber: number | null
    }
    assert.deepEqual(
      [movedOriginal.courseId, movedOriginal.pageId, movedOriginal.lectureNumber],
      [targetCourse.id, null, 3],
    )
    const movedChunks = await db
      .select({ courseId: schema.chunks.courseId })
      .from(schema.chunks)
      .where(and(eq(schema.chunks.sourceType, 'file'), eq(schema.chunks.sourceId, plain?.id as string)))
    assert.ok(
      movedChunks.every((c) => c.courseId === targetCourse.id),
      'Its search index moves with it',
    )
    assert.equal((await toCourse(sourceCourse.id, null)).status, 200)
    assert.equal((await markLecture(viewer, slides?.id as string, null)).status, 403)
    const unmarked = await markLecture(owner, slides?.id as string, null)
    assert.equal(((await unmarked.json()) as { lectureNumber: number | null }).lectureNumber, null)
    const handout = await markLecture(owner, plain?.id as string, 3)
    assert.equal(((await handout.json()) as { lectureNumber: number | null }).lectureNumber, 3)
    await markLecture(owner, plain?.id as string, null)
    await markLecture(owner, slides?.id as string, 3)
    // Every original, however many uploads came after it (the plain list is the latest 200).
    const originals = (await (
      await request(viewer, `/files?courseId=${sourceCourse.id}&originals=1`)
    ).json()) as {
      id: string
    }[]
    assert.deepEqual(
      originals.map((f) => f.id),
      [slides?.id],
    )

    // Calculators are tagged with a lecture of their course; a personal one cannot be.
    const lectureCalc = (body: Record<string, unknown>) =>
      request(owner, '/calculators', {
        method: 'POST',
        body: json({
          spec: {
            version: 1,
            name: 'Hohmann transfer',
            inputs: [{ key: 'r', label: 'Radius', unit: 'km', default: 7000 }],
            outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(398600 / r)' }],
          },
          ...body,
        }),
      })
    assert.equal(
      (await lectureCalc({ lectureNumber: 3 })).status,
      400,
      'A personal calculator has no lecture',
    )
    const tagged = await lectureCalc({ courseId: sourceCourse.id, lectureNumber: 3 })
    assert.equal(tagged.status, 201)
    const taggedCalc = (await tagged.json()) as { id: string; lectureNumber: number | null; spec: unknown }
    assert.equal(taggedCalc.lectureNumber, 3)
    assert.equal(
      (
        await request(owner, `/calculators/${taggedCalc.id}`, {
          method: 'PUT',
          body: json({ spec: taggedCalc.spec, courseId: null, lectureNumber: 3 }),
        })
      ).status,
      400,
      'Making it personal drops the lecture first',
    )
    const retagged = await request(owner, `/calculators/${taggedCalc.id}`, {
      method: 'PUT',
      body: json({ spec: taggedCalc.spec, courseId: sourceCourse.id, lectureNumber: 4 }),
    })
    assert.equal(((await retagged.json()) as { lectureNumber: number | null }).lectureNumber, 4)

    // Useful links: your own, web addresses only.
    const addLink = (actor: Actor, url: string) =>
      request(actor, '/links', {
        method: 'POST',
        body: json({ title: 'Space-Track', url, note: 'TLE catalogue' }),
      })
    assert.equal((await addLink(owner, 'javascript:alert(1)')).status, 400)
    assert.equal((await addLink(owner, 'ftp://example.test/file')).status, 400)
    const link = await addLink(owner, 'https://www.space-track.org/')
    assert.equal(link.status, 201)
    const linkId = ((await link.json()) as { id: string }).id
    assert.deepEqual(
      ((await (await request(owner, '/links')).json()) as { url: string }[]).map((l) => l.url),
      ['https://www.space-track.org/'],
    )
    assert.deepEqual(await (await request(viewer, '/links')).json(), [])
    assert.equal((await request(viewer, `/links/${linkId}`, { method: 'DELETE' })).status, 404)
    assert.equal((await request(owner, '/links/not-an-id', { method: 'DELETE' })).status, 400)
    assert.equal((await request(owner, `/links/${linkId}`, { method: 'DELETE' })).status, 204)

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

    // The imported topic hub references the imported copy of the lecture, not the original.
    const copies = await db
      .select({ id: schema.pages.id, title: schema.pages.title })
      .from(schema.pages)
      .innerJoin(schema.courses, eq(schema.courses.id, schema.pages.courseId))
      .where(
        and(
          eq(schema.courses.createdBy, owner.id),
          inArray(schema.pages.title, ['Orbital transfers', 'Transfers (topic hub)']),
        ),
      )
    const lectureCopy = copies.find((p) => p.title === 'Orbital transfers' && p.id !== lecture.id)
    const restoredOriginals = await db
      .select({ id: schema.files.id, lectureNumber: schema.files.lectureNumber })
      .from(schema.files)
      .innerJoin(schema.courses, eq(schema.courses.id, schema.files.courseId))
      .where(and(eq(schema.courses.createdBy, owner.id), eq(schema.files.name, 'slides-3.txt')))
    assert.deepEqual(
      restoredOriginals.map((f) => f.lectureNumber),
      [3, 3],
      'The original and its restored copy both mark lecture 3 (in their own courses)',
    )
    const restoredCalcs = await db
      .select({ lectureNumber: schema.calculators.lectureNumber })
      .from(schema.calculators)
      .where(and(eq(schema.calculators.ownerId, owner.id), eq(schema.calculators.name, 'Hohmann transfer')))
    assert.deepEqual(
      restoredCalcs.map((c) => c.lectureNumber),
      [4, 4],
      'A calculator keeps its lecture in the restored copy',
    )
    const hubCopy = copies.find((p) => p.title === 'Transfers (topic hub)' && p.id !== hub.id)
    assert.ok(lectureCopy && hubCopy)
    const copiedReferences = await db
      .select()
      .from(schema.pageReferences)
      .where(eq(schema.pageReferences.sourcePageId, hubCopy.id))
    assert.deepEqual(
      copiedReferences.map((r) => [r.targetPageId, r.targetNodeId]),
      [[lectureCopy.id, headingId]],
    )

    // A whole lecture moves to another course: its original, its pages and its calculators, renumbered there.
    const partResponse = await request(owner, '/pages', {
      method: 'POST',
      body: json({
        courseId: sourceCourse.id,
        title: 'Lecture 4 notes',
        type: 'note',
        lectureNumber: 4,
        content: { type: 'doc', content: [] },
      }),
    })
    const part = (await partResponse.json()) as { id: string }
    await markLecture(owner, slides?.id as string, 4)
    const moveLecture = (actor: Actor, body: Record<string, unknown>) =>
      request(actor, '/lectures/move', {
        method: 'POST',
        body: json({ courseId: sourceCourse.id, lectureNumber: 4, toCourseId: targetCourse.id, ...body }),
      })
    assert.equal((await moveLecture(viewer, { toLectureNumber: 7 })).status, 403)
    const lectureMoved = await moveLecture(owner, { toLectureNumber: 7 })
    assert.equal(lectureMoved.status, 200)
    assert.deepEqual(await lectureMoved.json(), {
      original: { id: slides?.id, courseId: targetCourse.id, lectureNumber: 7 },
      pages: 1,
      calculators: 1,
    })
    const [movedPart] = await db
      .select({ courseId: schema.pages.courseId, lectureNumber: schema.pages.lectureNumber })
      .from(schema.pages)
      .where(eq(schema.pages.id, part.id))
    assert.deepEqual(movedPart, { courseId: targetCourse.id, lectureNumber: 7 })
    const [movedCalc] = await db
      .select({ courseId: schema.calculators.courseId, lectureNumber: schema.calculators.lectureNumber })
      .from(schema.calculators)
      .where(eq(schema.calculators.id, taggedCalc.id))
    assert.deepEqual(movedCalc, { courseId: targetCourse.id, lectureNumber: 7 })
    const slideChunks = await db
      .select({ courseId: schema.chunks.courseId })
      .from(schema.chunks)
      .where(and(eq(schema.chunks.sourceType, 'file'), eq(schema.chunks.sourceId, slides?.id as string)))
    assert.ok(
      slideChunks.every((c) => c.courseId === targetCourse.id),
      'Its search index moves with it',
    )
    // Moving back onto a lecture that has an original meanwhile is refused, naming the holder.
    await markLecture(owner, plain?.id as string, 4)
    const backOnto = await request(owner, '/lectures/move', {
      method: 'POST',
      body: json({
        courseId: targetCourse.id,
        lectureNumber: 7,
        toCourseId: sourceCourse.id,
        toLectureNumber: 4,
        withParts: false,
      }),
    })
    assert.equal(backOnto.status, 409)
    assert.match(
      ((await backOnto.json()) as { error: string }).error,
      /Lecture 4 of Source course .*handout\.txt/,
    )
    assert.equal(
      (await moveLecture(owner, { courseId: targetCourse.id, lectureNumber: 7, toLectureNumber: 7 })).status,
      400,
      'Already there',
    )

    // Uploads: search by name (literally) and page through them.
    const fileNames = async (query: string) =>
      ((await (await request(owner, `/files?${query}`)).json()) as { id: string; name: string }[]).map(
        (f) => f.name,
      )
    const slideMatches = await fileNames('q=SLIDES')
    assert.ok(
      slideMatches.length > 0 && slideMatches.every((name) => name === 'slides-3.txt'),
      'Case-insensitive name search',
    )
    assert.deepEqual(await fileNames(`q=${encodeURIComponent('%')}`), [], '% is not a wildcard')
    // Ids, not names: the restored backup holds copies with the same names.
    const fileIds = async (query: string) =>
      ((await (await request(owner, `/files?${query}`)).json()) as { id: string }[]).map((f) => f.id)
    const uploadsPage1 = await fileIds('limit=1')
    const uploadsPage2 = await fileIds('limit=1&offset=1')
    assert.equal(uploadsPage1.length, 1)
    assert.equal(uploadsPage2.length, 1)
    assert.notDeepEqual(uploadsPage1, uploadsPage2)

    // A page moving to another course: calculators made from it keep a lecture tag only if it is the page's own.
    const taggedPage = (await (
      await request(owner, '/pages', {
        method: 'POST',
        body: json({
          courseId: sourceCourse.id,
          title: 'Lecture 5',
          type: 'lecture',
          lectureNumber: 5,
          content: { type: 'doc', content: [] },
        }),
      })
    ).json()) as { id: string }
    const fromPage = async (lectureNumber: number) =>
      (
        (await (
          await request(owner, '/calculators', {
            method: 'POST',
            body: json({
              courseId: sourceCourse.id,
              sourcePageId: taggedPage.id,
              lectureNumber,
              spec: {
                version: 1,
                name: `From lecture 5, tagged ${lectureNumber}`,
                inputs: [{ key: 'r', label: 'Radius', unit: 'km', default: 7000 }],
                outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(398600 / r)' }],
              },
            }),
          })
        ).json()) as { id: string }
      ).id
    const sameTag = await fromPage(5)
    const otherTag = await fromPage(6)
    assert.equal(
      (
        await request(owner, `/pages/${taggedPage.id}/move`, {
          method: 'POST',
          body: json({ courseId: targetCourse.id }),
        })
      ).status,
      200,
    )
    const followed = await db
      .select({
        id: schema.calculators.id,
        courseId: schema.calculators.courseId,
        lectureNumber: schema.calculators.lectureNumber,
      })
      .from(schema.calculators)
      .where(inArray(schema.calculators.id, [sameTag, otherTag]))
    assert.deepEqual(
      [sameTag, otherTag].map((id) => {
        const c = followed.find((row) => row.id === id)
        return [c?.courseId, c?.lectureNumber]
      }),
      [
        [targetCourse.id, 5],
        [targetCourse.id, null],
      ],
    )

    // The Backup page knows when your last backup finished.
    const lastBackup = async (actor: Actor) =>
      ((await (await request(actor, '/backup/status')).json()) as { lastBackupAt: string | null })
        .lastBackupAt
    assert.ok(lastBackup && (await lastBackup(owner)), 'The owner downloaded a backup above')
    assert.equal(await lastBackup(viewer), null)

    // Personal calculators with a course tag: a viewer of the course may tag their own with it, unshared.
    const viewerCalcResponse = await request(viewer, '/calculators', {
      method: 'POST',
      body: json({
        courseId: sourceCourse.id,
        lectureNumber: 2,
        spec: {
          version: 1,
          name: 'Escape speed',
          inputs: [{ key: 'r', label: 'Radius', unit: 'km', default: 7000 }],
          constants: { mu: 398600.4418 },
          constantMetadata: { mu: { name: 'Gravitational parameter', symbol: 'μ', unit: 'km³/s²' } },
          outputs: [{ key: 'v', label: 'Escape speed', unit: 'km/s', expr: 'sqrt(2 * mu / r)' }],
        },
      }),
    })
    assert.equal(viewerCalcResponse.status, 201)
    const viewerCalc = (await viewerCalcResponse.json()) as { id: string }
    assert.equal((await request(owner, `/calculators/${viewerCalc.id}`)).status, 404, 'Not shared')
    // Archived: out of the tutor's search, still yours; restored, back.
    const archived = await request(viewer, `/calculators/${viewerCalc.id}/archive`, {
      method: 'PATCH',
      body: json({ archived: true }),
    })
    assert.ok(((await archived.json()) as { archivedAt: string | null }).archivedAt)
    assert.deepEqual(await calculatorLibrary(viewer.id).find('escape speed'), [])
    assert.equal((await request(viewer, `/calculators/${viewerCalc.id}`)).status, 200)
    await request(viewer, `/calculators/${viewerCalc.id}/archive`, {
      method: 'PATCH',
      body: json({ archived: false }),
    })
    assert.equal((await calculatorLibrary(viewer.id).find('escape speed')).length, 1)
    // Duplicate: a copy with its tag, remembering the original.
    const copyResponse = await request(viewer, `/calculators/${viewerCalc.id}/duplicate`, { method: 'POST' })
    assert.equal(copyResponse.status, 201)
    const copy = (await copyResponse.json()) as {
      name: string
      courseId: string
      lectureNumber: number
      copiedFromId: string
      spec: { name: string }
    }
    assert.deepEqual(
      [copy.name, copy.spec.name, copy.courseId, copy.lectureNumber, copy.copiedFromId],
      ['Escape speed (copy)', 'Escape speed (copy)', sourceCourse.id, 2, viewerCalc.id],
    )
    assert.equal(
      (await request(owner, `/calculators/${viewerCalc.id}/duplicate`, { method: 'POST' })).status,
      404,
    )
    // Rework with AI: needs instructions; only yours.
    const reworkAsk = (actor: Actor, instructions: string) =>
      request(actor, `/ai/calculators/${viewerCalc.id}/rework`, {
        method: 'POST',
        body: json({ instructions }),
      })
    assert.equal((await reworkAsk(viewer, '')).status, 400)
    assert.equal((await reworkAsk(owner, 'Solve for the radius instead')).status, 404)
    // Leaving the course clears the tag of your calculators; they stay yours.
    assert.equal(
      (await request(owner, `/courses/${sourceCourse.id}/members/${viewer.id}`, { method: 'DELETE' })).status,
      204,
    )
    const untagged = (await (await request(viewer, `/calculators/${viewerCalc.id}`)).json()) as {
      courseId: string | null
      lectureNumber: number | null
    }
    assert.deepEqual([untagged.courseId, untagged.lectureNumber], [null, null])
  },
)
