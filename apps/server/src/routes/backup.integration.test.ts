import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startTestApi } from '../testing/api'
import { testDatabaseUrl } from '../testing/database'

test(
  'backup: export, preview and restore a course with its references, lectures and calculators',
  {
    skip: !testDatabaseUrl,
    timeout: 120_000,
  },
  async (t) => {
    if (!testDatabaseUrl) return
    const api = await startTestApi(t, testDatabaseUrl)
    const { db, schema, request, send, ok } = api
    const { and, eq, inArray } = api.orm
    const owner = await api.signup('owner')
    const viewer = await api.signup('viewer')
    const course = await api.courseWith(owner, 'Source course', [[viewer, 'viewer']])
    await ok(
      send(owner, 'POST', `/courses/${course.id}/constants`, {
        key: 'SOUND_SPEED',
        name: 'Speed of sound',
        symbol: 'c_s',
        value: 343,
        unit: 'm/s',
      }),
      201,
    )
    const lecture = await api.createPage(owner, {
      courseId: course.id,
      title: 'Orbital transfers',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hohmann transfer' }] },
      ],
    })
    const headingId = lecture.content.content[0]?.attrs?.id
    const hub = await api.createPage(owner, {
      courseId: course.id,
      title: 'Transfers (topic hub)',
      type: 'theory',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Hohmann transfer',
              marks: [{ type: 'link', attrs: { href: `/pages/${lecture.id}#${headingId}` } }],
            },
          ],
        },
      ],
    })
    await ok(
      api.upload(owner, course.id, [{ name: 'slides-3.txt', body: 'Lecture slides.' }], {
        lectureNumber: '3',
      }),
      201,
    )
    await api.createCalculator(owner, 'Hohmann transfer', { courseId: course.id, lectureNumber: 4 })

    const lastBackup = async (actor: typeof owner) =>
      (await ok<{ lastBackupAt: string | null }>(request(actor, '/backup/status'))).lastBackupAt
    assert.equal(await lastBackup(owner), null)

    const exported = await request(owner, '/backup/export')
    assert.equal(exported.status, 200)
    const archive = await exported.blob()
    const form = () => {
      const body = new FormData()
      body.set('archive', archive, 'backup.zip')
      return body
    }
    type Summary = { pages: number; files: number; constants: number }

    await t.test('a preview counts what the archive holds, changing nothing', async () => {
      const preview = await ok<Summary>(request(owner, '/backup/preview', { method: 'POST', body: form() }))
      assert.deepEqual([preview.pages, preview.files, preview.constants], [2, 1, 1])
      assert.ok(await lastBackup(owner), 'The Backup page knows when your last backup finished')
      assert.equal(await lastBackup(viewer), null)
    })

    await t.test(
      'restoring makes copies whose references, originals and calculators point at each other',
      async () => {
        const restored = await ok<Summary>(request(owner, '/backup/import', { method: 'POST', body: form() }))
        assert.deepEqual([restored.pages, restored.files, restored.constants], [2, 1, 1])
        const pages = await db
          .select({ id: schema.pages.id, title: schema.pages.title })
          .from(schema.pages)
          .innerJoin(schema.courses, eq(schema.courses.id, schema.pages.courseId))
          .where(
            and(
              eq(schema.courses.createdBy, owner.id),
              inArray(schema.pages.title, ['Orbital transfers', 'Transfers (topic hub)']),
            ),
          )
        const lectureCopy = pages.find((p) => p.title === 'Orbital transfers' && p.id !== lecture.id)
        const hubCopy = pages.find((p) => p.title === 'Transfers (topic hub)' && p.id !== hub.id)
        assert.ok(lectureCopy && hubCopy)
        const references = await db
          .select()
          .from(schema.pageReferences)
          .where(eq(schema.pageReferences.sourcePageId, hubCopy.id))
        assert.deepEqual(
          references.map((r) => [r.targetPageId, r.targetNodeId]),
          [[lectureCopy.id, headingId]],
          'The copied hub references the copied lecture, not the original',
        )
        const originals = await db
          .select({ lectureNumber: schema.files.lectureNumber })
          .from(schema.files)
          .innerJoin(schema.courses, eq(schema.courses.id, schema.files.courseId))
          .where(and(eq(schema.courses.createdBy, owner.id), eq(schema.files.name, 'slides-3.txt')))
        assert.deepEqual(
          originals.map((f) => f.lectureNumber),
          [3, 3],
          'The original and its copy both mark lecture 3, each in its own course',
        )
        const calcs = await db
          .select({ lectureNumber: schema.calculators.lectureNumber })
          .from(schema.calculators)
          .where(
            and(eq(schema.calculators.ownerId, owner.id), eq(schema.calculators.name, 'Hohmann transfer')),
          )
        assert.deepEqual(
          calcs.map((c) => c.lectureNumber),
          [4, 4],
          'A calculator keeps its lecture in the copy',
        )
      },
    )

    await t.test('an archive that is not a backup is refused', async () => {
      const body = new FormData()
      body.set('archive', new Blob(['not a zip']), 'backup.zip')
      assert.equal((await request(owner, '/backup/preview', { method: 'POST', body })).status, 400)
    })
  },
)
