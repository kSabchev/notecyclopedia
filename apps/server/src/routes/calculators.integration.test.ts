import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startTestApi } from '../testing/api'
import { testDatabaseUrl } from '../testing/database'

test(
  'calculators: personal, exports, the chat tools, lecture tags, archive, duplicate',
  {
    skip: !testDatabaseUrl,
    timeout: 120_000,
  },
  async (t) => {
    if (!testDatabaseUrl) return
    const api = await startTestApi(t, testDatabaseUrl)
    const { request, send, ok } = api
    const owner = await api.signup('owner')
    const student = await api.signup('student')
    const classmate = await api.signup('classmate')
    const course = await api.courseWith(owner, 'Astrodynamics', [
      [student, 'editor'],
      [classmate, 'viewer'],
    ])
    const { calculatorLibrary } = await import('../services/calculator-library')
    const { runChatTool } = await import('../services/chat-tools')

    const calculator = await ok<{ id: string }>(
      send(student, 'POST', '/calculators', {
        courseId: course.id,
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
      201,
    )

    await t.test('calculators are personal, even when tagged with a shared course', async () => {
      assert.equal((await request(classmate, `/calculators/${calculator.id}`)).status, 404)
      const listed = await ok<{ id: string }[]>(request(classmate, '/calculators'))
      assert.ok(!listed.some((c) => c.id === calculator.id))
      assert.equal(
        (await request(classmate, `/calculators/${calculator.id}`, { method: 'DELETE' })).status,
        404,
      )
    })

    await t.test('exports: theory and steps in HTML and Python, formulas in Excel', async () => {
      const exported = async (format: string) => {
        const response = await request(student, `/calculators/${calculator.id}/export?format=${format}`)
        assert.equal(response.status, 200, `export ${format}`)
        return response
      }
      const html = await (await exported('html')).text()
      assert.match(html, /<h2>Step-by-step solution<\/h2>/)
      assert.match(html, /Gravity provides the centripetal force/)
      assert.match(await (await exported('py')).text(), /# Solve μ\/r² = v²\/r for v\./)
      const xlsx = await exported('xlsx')
      assert.equal(
        xlsx.headers.get('content-type'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      assert.match(xlsx.headers.get('content-disposition') ?? '', /circular-orbit\.xlsx/)
      const { default: unzipper } = await import('unzipper')
      const workbook = await unzipper.Open.buffer(Buffer.from(await xlsx.arrayBuffer()))
      const entry = (name: string) => workbook.files.find((f) => f.path === name)
      assert.ok(entry('[Content_Types].xml') && entry('xl/workbook.xml') && entry('xl/worksheets/sheet2.xml'))
      const sheet = (await entry('xl/worksheets/sheet1.xml')?.buffer())?.toString('utf8') ?? ''
      assert.match(sheet, /<f>SQRT\(\(\$B\$5\/\$B\$4\)\)<\/f><v>7\.54/)
      assert.equal((await request(student, `/calculators/${calculator.id}/export?format=pdf`)).status, 400)
    })

    await t.test('the chat tools find your own calculators by keyword, and run them', async () => {
      const library = calculatorLibrary(student.id)
      assert.deepEqual(
        (await library.find('circular speed')).map((c) => c.id),
        [calculator.id],
      )
      assert.deepEqual(await calculatorLibrary(classmate.id).find('circular speed'), [], 'Not a classmate’s')
      assert.equal(await calculatorLibrary(classmate.id).get(calculator.id), null)
      const run = await runChatTool(
        'run_calculator',
        { calculatorId: calculator.id, inputs: [{ key: 'r', value: 42164 }] },
        library,
      )
      assert.match(
        run.content,
        /v = sqrt\(mu \/ r\) = sqrt\(\(398600 km3\/s2\) \/ \(42164 km\)\) = 3\.075 km\/s/,
      )
      assert.equal(run.widget?.kind, 'calculator')
    })

    await t.test(
      'a calculator is tagged with a lecture of its course; a personal one cannot be',
      async () => {
        assert.equal(
          (
            await send(owner, 'POST', '/calculators', {
              lectureNumber: 3,
              spec: { version: 1, name: 'x', inputs: [], outputs: [] },
            })
          ).status,
          400,
        )
        const tagged = await api.createCalculator(owner, 'Hohmann transfer', {
          courseId: course.id,
          lectureNumber: 3,
        })
        assert.equal(tagged.lectureNumber, 3)
        const put = (body: Record<string, unknown>) =>
          send(owner, 'PUT', `/calculators/${tagged.id}`, { spec: tagged.spec, ...body })
        assert.equal(
          (await put({ courseId: null, lectureNumber: 3 })).status,
          400,
          'Making it personal drops the lecture',
        )
        assert.equal(
          (await ok<{ lectureNumber: number }>(put({ courseId: course.id, lectureNumber: 4 }))).lectureNumber,
          4,
        )
        const outsider = await api.signup('outsider')
        assert.equal(
          (
            await api.request(outsider, '/calculators', {
              method: 'POST',
              body: api.json({ courseId: course.id, spec: tagged.spec }),
            })
          ).status,
          404,
          'Only members tag a calculator with a course',
        )
      },
    )

    await t.test(
      'a viewer may tag their own calculator with the course; archive, duplicate, rework',
      async () => {
        const mine = await ok<{ id: string }>(
          send(classmate, 'POST', '/calculators', {
            courseId: course.id,
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
          201,
        )
        assert.equal((await request(owner, `/calculators/${mine.id}`)).status, 404, 'Not shared')
        const archive = (archived: boolean) =>
          send(classmate, 'PATCH', `/calculators/${mine.id}/archive`, { archived })
        assert.ok((await ok<{ archivedAt: string | null }>(archive(true))).archivedAt)
        assert.deepEqual(
          await calculatorLibrary(classmate.id).find('escape speed'),
          [],
          'Out of the tutor’s search',
        )
        assert.equal((await request(classmate, `/calculators/${mine.id}`)).status, 200, 'Still yours')
        await ok(archive(false))
        assert.equal((await calculatorLibrary(classmate.id).find('escape speed')).length, 1)

        const copy = await ok<{
          name: string
          courseId: string
          lectureNumber: number
          copiedFromId: string
          spec: { name: string }
        }>(request(classmate, `/calculators/${mine.id}/duplicate`, { method: 'POST' }), 201)
        assert.deepEqual(
          [copy.name, copy.spec.name, copy.courseId, copy.lectureNumber, copy.copiedFromId],
          ['Escape speed (copy)', 'Escape speed (copy)', course.id, 2, mine.id],
        )
        assert.equal(
          (await request(owner, `/calculators/${mine.id}/duplicate`, { method: 'POST' })).status,
          404,
        )

        const rework = (actor: typeof owner, instructions: string) =>
          send(actor, 'POST', `/ai/calculators/${mine.id}/rework`, { instructions })
        assert.equal((await rework(classmate, '')).status, 400)
        assert.equal((await rework(owner, 'Solve for the radius instead')).status, 404)
        assert.equal(
          (await rework(classmate, 'Solve for the radius instead')).status,
          503,
          'No API key in tests',
        )
        assert.equal((await request(classmate, `/calculators/${mine.id}`, { method: 'DELETE' })).status, 204)
        assert.equal((await request(classmate, `/calculators/${mine.id}`)).status, 404)
      },
    )
  },
)
