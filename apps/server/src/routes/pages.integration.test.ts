import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startTestApi } from '../testing/api'
import { testDatabaseUrl } from '../testing/database'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

test(
  'pages: roles, revisions, formulas, widgets, moving, terms and references, pins',
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
    const source = await api.courseWith(owner, 'Source course', [
      [editor, 'editor'],
      [viewer, 'viewer'],
    ])
    const target = await api.courseWith(owner, 'Target course', [[editor, 'editor']])

    const [uploaded] = await ok<{ id: string; pageId: string | null }[]>(
      api.upload(owner, source.id, [{ name: 'source.txt', body: 'A source file for a lecture.' }]),
      201,
    )
    assert.ok(uploaded)
    const pageInput = {
      courseId: source.id,
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
    type Page = {
      id: string
      revision: number
      lectureNumber: number
      content: { content: { attrs?: { id?: string } }[] }
    }
    let page!: Page
    let updatedInput!: Omit<typeof pageInput, 'sourceFileId'> & {
      sourceFileId?: undefined
      baseRevision: number
    }

    await t.test('editors write pages, viewers read them; a page takes its source file', async () => {
      assert.equal((await send(viewer, 'POST', '/pages', pageInput)).status, 403)
      page = await ok<Page>(send(editor, 'POST', '/pages', pageInput), 201)
      assert.equal(page.lectureNumber, 1)
      const attached = await ok<{ id: string; pageId: string | null }[]>(
        request(viewer, `/files?courseId=${source.id}&pageId=${page.id}`),
      )
      assert.equal(attached.find((f) => f.id === uploaded.id)?.pageId, page.id)
      assert.equal((await request(outsider, `/pages/${page.id}`)).status, 404)

      updatedInput = {
        ...pageInput,
        sourceFileId: undefined,
        title: 'Lecture one, revised',
        lectureNumber: 2,
        baseRevision: page.revision,
      }
      assert.equal((await send(viewer, 'PUT', `/pages/${page.id}`, updatedInput)).status, 403)
      const updated = await ok<Page>(send(editor, 'PUT', `/pages/${page.id}`, updatedInput))
      assert.deepEqual([updated.revision, updated.lectureNumber], [2, 2])
      assert.equal(
        (await send(editor, 'PUT', `/pages/${page.id}`, updatedInput)).status,
        409,
        'A save based on an old revision is refused',
      )
      updatedInput.baseRevision = updated.revision
    })

    const save = (baseRevision: number, blocks: unknown[]) =>
      send(editor, 'PUT', `/pages/${page.id}`, {
        ...updatedInput,
        baseRevision,
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Kepler orbit notes' }] },
            ...blocks,
          ],
        },
      })
    let revision = 0

    await t.test('the formula index follows edits and restores', async () => {
      const saveFormula = async (base: number, formula: Record<string, unknown>) =>
        ok<Page>(save(base, [{ type: 'formula', attrs: formula }]))
      const indexed = async () =>
        (await ok<{ id: string; pageId: string; latex: string }[]>(request(viewer, '/formulas')))
          .filter((row) => row.pageId === page.id)
          .map(({ id, latex }) => ({ id, latex }))
      const withFormula = await saveFormula(updatedInput.baseRevision, { latex: 'T = 2\\pi\\sqrt{a^3/\\mu}' })
      const formulaId = withFormula.content.content[1]?.attrs?.id
      assert.ok(formulaId, 'Saving gives the formula block an id')
      const [first] = await indexed()
      assert.ok(first)
      const edited = await saveFormula(withFormula.revision, {
        id: formulaId,
        latex: 'T = 2\\pi\\sqrt{a^3/GM}',
      })
      assert.equal(edited.content.content[1]?.attrs?.id, formulaId)
      assert.deepEqual(
        await indexed(),
        [{ id: first.id, latex: 'T = 2\\pi\\sqrt{a^3/GM}' }],
        'Same index row',
      )

      const restore = (actor: typeof owner) =>
        send(actor, 'POST', `/pages/${page.id}/revisions/${withFormula.revision}/restore`, {
          baseRevision: edited.revision,
        })
      assert.equal((await restore(viewer)).status, 403)
      assert.equal((await request(viewer, `/pages/${page.id}/revisions/latest`)).status, 404)
      const restored = await ok<Page>(restore(editor))
      assert.equal(restored.revision, edited.revision + 1)
      assert.deepEqual(await indexed(), [{ id: first.id, latex: 'T = 2\\pi\\sqrt{a^3/\\mu}' }])
      assert.equal((await restore(editor)).status, 409, 'Restoring on an old revision is refused')
      revision = restored.revision
    })

    let imageId = ''
    await t.test('widgets are checked on save; images shown on a page are linked to it', async () => {
      const spec = {
        version: 1,
        name: 'Circular orbit',
        inputs: [
          { key: 'r', label: 'Radius', unit: 'km', default: 7000 },
          { key: 'mu', label: 'Gravitational parameter', unit: 'km3/s2', default: 398600 },
        ],
        outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / r)' }],
      }
      const [image] = await ok<{ id: string; pageId: string | null }[]>(
        api.upload(editor, source.id, [{ name: 'orbit.png', body: PNG, type: 'image/png' }]),
        201,
      )
      assert.ok(image)
      assert.equal(image.pageId, null)
      imageId = image.id
      const plot = (x: string) => ({
        type: 'widget',
        attrs: { kind: 'plot', spec, plot: { x, y: ['v'], from: 6500, to: 42000 } },
      })
      const invalid = await save(revision, [plot('nope')])
      assert.equal(invalid.status, 400)
      assert.match(((await invalid.json()) as { error: string }).error, /Unknown input "nope"/)
      await ok(
        save(revision, [plot('r'), { type: 'image', attrs: { fileId: image.id, caption: 'Orbit sketch' } }]),
      )
      const files = await ok<{ id: string }[]>(request(editor, `/files?pageId=${page.id}`))
      assert.ok(files.some((f) => f.id === image.id))

      // Without the job worker, a save is indexed straight away; the plot's description is indexed with the text.
      const chunks = await db
        .select({ text: schema.chunks.text })
        .from(schema.chunks)
        .where(eq(schema.chunks.sourceId, page.id))
      assert.ok(chunks.some((c) => c.text.includes('Kepler orbit notes') && c.text.includes('Plot of Speed')))
    })

    await t.test('a page moves to another course with its source file and images', async () => {
      assert.equal(
        (await send(viewer, 'POST', `/pages/${page.id}/move`, { courseId: target.id })).status,
        403,
      )
      const moved = await ok<{ courseId: string }>(
        send(editor, 'POST', `/pages/${page.id}/move`, { courseId: target.id }),
      )
      assert.equal(moved.courseId, target.id)
      const files = await ok<{ id: string }[]>(
        request(editor, `/files?courseId=${target.id}&pageId=${page.id}`),
      )
      assert.ok(files.some((f) => f.id === uploaded.id))
      assert.ok(
        files.some((f) => f.id === imageId),
        'An image shown on the page moves with it',
      )
    })

    const lecture = await api.createPage(owner, {
      courseId: source.id,
      title: 'Orbital transfers',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hohmann transfer' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two burns between circular orbits.' }] },
      ],
    })
    const headingId = lecture.content.content[0]?.attrs?.id
    assert.ok(headingId, 'The server gives headings an id')

    await t.test('headings become terms: searchable, and other pages can reference them', async () => {
      const hub = await api.createPage(owner, {
        courseId: source.id,
        title: 'Transfers (topic hub)',
        type: 'theory',
        content: [
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
        ],
      })
      const hits = await ok<unknown[]>(request(viewer, '/search?q=hohmann'))
      assert.deepEqual(hits[0], {
        kind: 'term',
        id: lecture.id,
        title: 'Hohmann transfer',
        courseId: source.id,
        snippet: 'Orbital transfers',
        anchor: headingId,
      })
      assert.deepEqual(await ok(request(outsider, '/search?q=hohmann')), [], 'Only your courses are searched')
      assert.deepEqual(await ok(request(viewer, `/pages/${lecture.id}/references`)), [
        {
          sourcePageId: hub.id,
          sourceTitle: 'Transfers (topic hub)',
          sourceType: 'theory',
          targetNodeId: headingId,
        },
      ])
      assert.equal((await request(outsider, `/pages/${lecture.id}/references`)).status, 404)

      // A topic hub may link to the course's matching sections and lectures, but not to other hubs.
      const { hubTargets } = await import('../services/topic-hub')
      assert.deepEqual(
        (await hubTargets(source.id, 'Hohmann transfer')).map((x) => [x.pageId, x.nodeId]),
        [
          [lecture.id, headingId],
          [lecture.id, null],
        ],
      )
    })

    await t.test('formula pins are personal; formula cards show the same formula elsewhere', async () => {
      const formulaPage = (title: string, latex: string) =>
        api.createPage(owner, {
          courseId: source.id,
          title,
          content: [{ type: 'formula', attrs: { latex } }],
        })
      const visViva = await formulaPage('Vis-viva', 'v^2 = \\mu \\left(\\frac{2}{r} - \\frac{1}{a}\\right)')
      const same = await formulaPage('Energy', 'v^2=\\mu\\left(\\frac{2}{r}-\\frac{1}{a}\\right)')
      await formulaPage('Unrelated', 'E = mc^2')
      const node = visViva.content.content[0]?.attrs?.id as string
      const pin = (actor: typeof owner, nodeId = node) =>
        send(actor, 'POST', '/formulas/pins', { pageId: visViva.id, nodeId })
      const pinned = async (actor: typeof owner) =>
        (await ok<{ pageId: string; nodeId: string }[]>(request(actor, '/formulas?pinned=1')))
          .filter((f) => f.pageId === visViva.id)
          .map((f) => f.nodeId)
      assert.equal((await pin(owner)).status, 204)
      assert.equal((await pin(owner)).status, 204, 'Pinning twice is harmless')
      assert.deepEqual(await pinned(owner), [node])
      assert.deepEqual(await pinned(viewer), [], "Another member's pins are not yours")
      assert.equal((await pin(viewer)).status, 204, 'Viewers can pin for themselves')
      const all = await ok<{ nodeId: string; pinned: boolean }[]>(request(owner, '/formulas'))
      assert.equal(all.find((f) => f.nodeId === node)?.pinned, true)
      assert.equal((await pin(outsider)).status, 404)
      assert.equal((await pin(owner, 'no-such-formula')).status, 404)
      assert.equal((await ok<{ revision: number }>(request(owner, `/pages/${visViva.id}`))).revision, 1)
      const unpin = await request(owner, `/formulas/pins?pageId=${visViva.id}&nodeId=${node}`, {
        method: 'DELETE',
      })
      assert.equal(unpin.status, 204)
      assert.deepEqual(await pinned(owner), [])
      assert.deepEqual(await pinned(viewer), [node], "Unpinning leaves others' pins alone")

      await api.createCalculator(owner, 'Vis-viva speed', { courseId: source.id, sourcePageId: visViva.id })
      // A classmate's personal calculator from the same page is theirs alone.
      await api.createCalculator(editor, 'Editor personal calculator', { sourcePageId: visViva.id })
      const related = await ok<{
        elsewhere: { pageId: string; pageTitle: string }[]
        calculators: { name: string }[]
      }>(request(owner, `/formulas/related?pageId=${visViva.id}&nodeId=${node}`))
      assert.deepEqual(
        related.elsewhere.map((f) => [f.pageId, f.pageTitle]),
        [[same.id, 'Energy']],
      )
      assert.deepEqual(
        related.calculators.map((c) => c.name),
        ['Vis-viva speed'],
      )
      assert.equal(
        (await request(outsider, `/formulas/related?pageId=${visViva.id}&nodeId=${node}`)).status,
        404,
      )
    })

    await t.test(
      'calculators made from a page keep its lecture tag when it moves, other tags are dropped',
      async () => {
        const tagged = await api.createPage(owner, {
          courseId: source.id,
          title: 'Lecture 5',
          lectureNumber: 5,
        })
        const fromPage = (n: number) =>
          api.createCalculator(owner, `From lecture 5, tagged ${n}`, {
            courseId: source.id,
            sourcePageId: tagged.id,
            lectureNumber: n,
          })
        const sameTag = await fromPage(5)
        const otherTag = await fromPage(6)
        await ok(send(owner, 'POST', `/pages/${tagged.id}/move`, { courseId: target.id }))
        const after = async (id: string) => {
          const c = await ok<{ courseId: string; lectureNumber: number | null }>(
            request(owner, `/calculators/${id}`),
          )
          return [c.courseId, c.lectureNumber]
        }
        assert.deepEqual(await after(sameTag.id), [target.id, 5])
        assert.deepEqual(await after(otherTag.id), [target.id, null])
      },
    )
  },
)
