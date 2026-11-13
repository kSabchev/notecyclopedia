import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startTestApi } from '../testing/api'
import { testDatabaseUrl } from '../testing/database'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

test(
  'files: indexing, how they are served, original lectures, moving lectures, search and paging',
  {
    skip: !testDatabaseUrl,
    timeout: 180_000,
  },
  async (t) => {
    if (!testDatabaseUrl) return
    // The only test with the job worker: it waits for uploads to be indexed.
    const api = await startTestApi(t, testDatabaseUrl, { jobs: true })
    const { db, schema, request, send, ok } = api
    const { and, eq } = api.orm
    const owner = await api.signup('owner')
    const editor = await api.signup('editor')
    const viewer = await api.signup('viewer')
    const source = await api.courseWith(owner, 'Source course', [
      [editor, 'editor'],
      [viewer, 'viewer'],
    ])
    const target = await api.courseWith(owner, 'Target course')
    type Upload = {
      id: string
      name: string
      mime: string
      pageId: string | null
      lectureNumber: number | null
    }
    const indexed = (id: string, courseId = source.id) =>
      api.waitFor(`Indexing ${id}`, async () => {
        const files = await ok<{ id: string; status: string }[]>(
          request(owner, `/files?courseId=${courseId}`),
        )
        return files.find((f) => f.id === id)?.status === 'indexed'
      })
    const chunksOf = (id: string) =>
      db
        .select({ courseId: schema.chunks.courseId })
        .from(schema.chunks)
        .where(and(eq(schema.chunks.sourceType, 'file'), eq(schema.chunks.sourceId, id)))

    await t.test('an upload is indexed in the background; viewers cannot upload', async () => {
      const [notes] = await ok<Upload[]>(
        api.upload(owner, source.id, [{ name: 'source.txt', body: 'A source file for an indexed lecture.' }]),
        201,
      )
      assert.ok(notes)
      await indexed(notes.id)
      assert.ok((await chunksOf(notes.id)).length > 0)
      assert.equal((await api.upload(viewer, source.id, [{ name: 'x.txt', body: 'x' }])).status, 403)
    })

    await t.test('files are served by their extension’s type, whatever the browser claimed', async () => {
      const [disguised] = await ok<Upload[]>(
        api.upload(editor, source.id, [
          { name: 'notes.txt', body: '<script>alert(1)</script>', type: 'text/html' },
        ]),
        201,
      )
      assert.ok(disguised)
      assert.equal(disguised.mime, 'text/plain; charset=utf-8')
      const served = await request(viewer, `/files/${disguised.id}/download?inline=1`)
      assert.equal(served.headers.get('content-type'), 'text/plain; charset=utf-8')
      const [image] = await ok<Upload[]>(
        api.upload(editor, source.id, [{ name: 'orbit.png', body: PNG, type: 'image/png' }]),
        201,
      )
      const servedImage = await request(viewer, `/files/${image?.id}/download?inline=1`)
      assert.equal(servedImage.headers.get('content-type'), 'image/png')
      assert.match(servedImage.headers.get('content-disposition') ?? '', /^inline/)
    })

    const uploadOriginal = (n: number | null, names = ['slides-3.txt']) =>
      api.upload(
        owner,
        source.id,
        names.map((name) => ({ name, body: 'Lecture slides.' })),
        n === null ? {} : { lectureNumber: String(n) },
      )
    const markLecture = (actor: typeof owner, id: string, lectureNumber: number | null, courseId?: string) =>
      send(actor, 'PATCH', `/files/${id}/lecture`, { lectureNumber, ...(courseId ? { courseId } : {}) })
    let slides!: Upload
    let handout!: Upload

    await t.test('an upload can be the original of lecture N of its course, one per lecture', async () => {
      ;[slides] = (await ok<Upload[]>(uploadOriginal(3), 201)) as [Upload]
      assert.equal(slides.lectureNumber, 3)
      assert.equal((await uploadOriginal(3, ['other.txt'])).status, 409, 'One original per lecture')
      assert.equal(
        (await uploadOriginal(4, ['a.txt', 'b.txt'])).status,
        400,
        'An original is uploaded on its own',
      )
      ;[handout] = (await ok<Upload[]>(uploadOriginal(null, ['handout.txt']), 201)) as [Upload]
      const taken = await markLecture(owner, handout.id, 3)
      assert.equal(taken.status, 409)
      assert.match(
        ((await taken.json()) as { error: string }).error,
        /^Lecture 3 of Source course already has an original \(slides-3\.txt\)\./,
        'The message names the course and the file holding the lecture',
      )
      assert.equal((await markLecture(viewer, slides.id, null)).status, 403)
      assert.equal((await ok<Upload>(markLecture(owner, slides.id, null))).lectureNumber, null)
      assert.equal((await ok<Upload>(markLecture(owner, handout.id, 3))).lectureNumber, 3)
      await ok(markLecture(owner, handout.id, null))
      await ok(markLecture(owner, slides.id, 3))
      // Every original, however many uploads came after it (the plain list is the latest 200).
      const originals = await ok<{ id: string }[]>(
        request(viewer, `/files?courseId=${source.id}&originals=1`),
      )
      assert.deepEqual(
        originals.map((f) => f.id),
        [slides.id],
      )
    })

    await t.test(
      'lecture numbers are per course: a file moves to another course with its index',
      async () => {
        await indexed(handout.id)
        const moved = await ok<Upload & { courseId: string }>(markLecture(owner, handout.id, 3, target.id))
        assert.deepEqual([moved.courseId, moved.pageId, moved.lectureNumber], [target.id, null, 3])
        const chunks = await chunksOf(handout.id)
        assert.ok(
          chunks.length > 0 && chunks.every((c) => c.courseId === target.id),
          'Its search index moves too',
        )
        await ok(markLecture(owner, handout.id, null, source.id))
      },
    )

    await t.test('a whole lecture moves: its original, pages and calculators, renumbered', async () => {
      const part = await api.createPage(owner, {
        courseId: source.id,
        title: 'Lecture 4 notes',
        type: 'note',
        lectureNumber: 4,
      })
      const calc = await api.createCalculator(owner, 'Hohmann transfer', {
        courseId: source.id,
        lectureNumber: 4,
      })
      await ok(markLecture(owner, slides.id, 4))
      await indexed(slides.id)
      const move = (actor: typeof owner, body: Record<string, unknown>) =>
        send(actor, 'POST', '/lectures/move', {
          courseId: source.id,
          lectureNumber: 4,
          toCourseId: target.id,
          ...body,
        })
      assert.equal((await move(viewer, { toLectureNumber: 7 })).status, 403)
      assert.deepEqual(await ok(move(owner, { toLectureNumber: 7 })), {
        original: { id: slides.id, courseId: target.id, lectureNumber: 7 },
        pages: 1,
        calculators: 1,
      })
      const [movedPart] = await db
        .select({ courseId: schema.pages.courseId, lectureNumber: schema.pages.lectureNumber })
        .from(schema.pages)
        .where(eq(schema.pages.id, part.id))
      assert.deepEqual(movedPart, { courseId: target.id, lectureNumber: 7 })
      const movedCalc = await ok<{ courseId: string; lectureNumber: number }>(
        request(owner, `/calculators/${calc.id}`),
      )
      assert.deepEqual([movedCalc.courseId, movedCalc.lectureNumber], [target.id, 7])
      const chunks = await chunksOf(slides.id)
      assert.ok(
        chunks.length > 0 && chunks.every((c) => c.courseId === target.id),
        'Its search index moves too',
      )

      // Moving back onto a lecture that has an original meanwhile is refused, naming the holder.
      await ok(markLecture(owner, handout.id, 4))
      const back = await send(owner, 'POST', '/lectures/move', {
        courseId: target.id,
        lectureNumber: 7,
        toCourseId: source.id,
        toLectureNumber: 4,
        withParts: false,
      })
      assert.equal(back.status, 409)
      assert.match(
        ((await back.json()) as { error: string }).error,
        /Lecture 4 of Source course .*handout\.txt/,
      )
      assert.equal(
        (await move(owner, { courseId: target.id, lectureNumber: 7, toLectureNumber: 7 })).status,
        400,
        'Already there',
      )
    })

    await t.test('uploads: search by name, literally, and page through them', async () => {
      const names = async (query: string) =>
        (await ok<{ name: string }[]>(request(owner, `/files?${query}`))).map((f) => f.name)
      assert.deepEqual(await names('q=SLIDES'), ['slides-3.txt'], 'Case-insensitive name search')
      assert.deepEqual(await names(`q=${encodeURIComponent('%')}`), [], '% is not a wildcard')
      const ids = async (query: string) =>
        (await ok<{ id: string }[]>(request(owner, `/files?${query}`))).map((f) => f.id)
      const [page1, page2] = [await ids('limit=1'), await ids('limit=1&offset=1')]
      assert.equal(page1.length, 1)
      assert.equal(page2.length, 1)
      assert.notDeepEqual(page1, page2)
    })
  },
)
