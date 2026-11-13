import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startTestApi } from '../testing/api'
import { testDatabaseUrl } from '../testing/database'

test(
  'study: daily questions, where was I, quick checks, exam plans and sharing them',
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
    const target = await api.courseWith(owner, 'Target course')
    const lecture = await api.createPage(owner, {
      courseId: source.id,
      title: 'Orbital transfers',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hohmann transfer' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Two burns between circular orbits.' }] },
      ],
    })
    const visViva = await api.createPage(owner, {
      courseId: source.id,
      title: 'Vis-viva',
      content: [{ type: 'formula', attrs: { latex: 'v^2 = \\mu (2/r - 1/a)' } }],
    })

    await t.test('without an API key, the AI routes say so', async () => {
      assert.equal(
        (await send(viewer, 'POST', '/ai/chat', { mode: 'check', message: 'Is this right?' })).status,
        503,
      )
      assert.equal(
        (await send(owner, 'POST', '/ai/topic-hub', { courseId: source.id, topic: 'Hohmann' })).status,
        503,
      )
      assert.equal((await send(viewer, 'POST', '/daily/today', {})).status, 503)
      assert.equal((await send(viewer, 'POST', '/daily', {})).status, 503)
      assert.deepEqual(await ok(request(viewer, '/ai/status')), { configured: false })
    })

    await t.test('the daily question: on request, once a day, about a topic of your lectures', async () => {
      const daily = await import('../services/daily-question')
      const { day, question: none } = await ok<{ day: string; question: unknown }>(
        request(owner, '/daily/today'),
      )
      assert.match(day, /^\d{4}-\d{2}-\d{2}$/)
      assert.equal(none, null)
      let calls = 0
      const prompts: string[] = []
      const fakeClaude = (async (
        req: { tools?: { name: string }[]; messages: { content: unknown }[] },
        opts: { meter?: { add: (model: string, usage: object) => void } },
      ) => {
        calls++
        prompts.push(String(req.messages[0]?.content))
        const tool = req.tools?.[0]?.name
        // As the real client does: count the call towards the question's cost.
        opts.meter?.add('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 })
        return {
          model: 'claude-sonnet-5-5',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: `call_${calls}`,
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
      }) as unknown as Parameters<typeof daily.generateDailyQuestion>[3]

      const made = await daily.generateDailyQuestion(owner.id, day, { courseId: source.id }, fakeClaude)
      assert.equal(made.courseId, source.id)
      assert.match(prompts[0] ?? '', /Write everything in English./, 'The language is decided from the notes')
      assert.equal(made.question, 'Why does a Hohmann transfer need two burns?')
      assert.equal(made.usage?.inputTokens, 1000)
      const again = await daily.generateDailyQuestion(owner.id, day, {}, fakeClaude)
      assert.equal(again.id, made.id)
      assert.equal(calls, 1, 'One question a day: the second request does not call Claude')
      const today = async () =>
        (await ok<{ question: { id: string } }>(request(owner, '/daily/today'))).question.id
      assert.equal(await today(), made.id)

      const expanded = await daily.expandDailyQuestion(made, 'story', owner.id, 'en', fakeClaude)
      assert.match(expanded.expansions.story ?? '', /Apollo/)
      assert.equal(expanded.usage?.inputTokens, 2000)
      // A stored expansion is returned without calling Claude (there is no API key here).
      await ok(send(owner, 'POST', `/daily/${made.id}/expand`, { kind: 'story' }))
      assert.equal((await send(outsider, 'POST', `/daily/${made.id}/expand`, { kind: 'story' })).status, 404)

      // Saving appends the question to its page as a new revision.
      const labels = { question: 'Question', answer: 'Answer', story: 'Story', advanced: 'Harder question' }
      await ok(send(owner, 'POST', `/daily/${made.id}/save`, { labels }))
      const saved = await ok<{ content: { content: { type: string; content?: { text?: string }[] }[] } }>(
        request(owner, `/pages/${made.pageId}`),
      )
      assert.ok(
        saved.content.content.some(
          (b) => b.type === 'heading' && b.content?.[0]?.text === `Question: ${made.topic}`,
        ),
      )

      // A question on demand comes in addition to today's, and avoids repeating it.
      const extra = await daily.generateDailyQuestion(owner.id, day, { onDemand: true }, fakeClaude)
      assert.notEqual(extra.id, made.id)
      assert.ok(
        extra.topic !== made.topic || (prompts.at(-1) ?? '').includes(made.question),
        'A repeated topic shows Claude the earlier question',
      )
      assert.equal(await today(), made.id, "The first question of the day stays today's question")
      assert.deepEqual(
        (await ok<{ id: string }[]>(request(owner, '/daily'))).map((q) => q.id),
        [extra.id, made.id],
      )
      assert.deepEqual(await ok(request(owner, '/daily?q=no-such-question')), [])
      assert.equal((await ok<unknown[]>(request(owner, '/daily?q=two%20burns'))).length, 2)
    })

    let answerId = ''
    await t.test(
      'where was I: pages you opened and what your questions were about, your own only',
      async () => {
        assert.equal((await request(owner, `/pages/${visViva.id}/visit`, { method: 'POST' })).status, 204)
        assert.equal((await request(owner, `/pages/${lecture.id}/visit`, { method: 'POST' })).status, 204)
        assert.equal((await request(outsider, `/pages/${lecture.id}/visit`, { method: 'POST' })).status, 404)
        const [thread] = await db
          .insert(schema.aiThreads)
          .values({ userId: owner.id, title: 'Why two burns?', mode: 'tutor' })
          .returning()
        assert.ok(thread)
        const [, answer] = await db
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
        assert.ok(answer)
        answerId = answer.id
        const where = await ok<{
          viewed: { id: string }[]
          threads: { id: string; mode: string }[]
          topics: { pageId: string; title: string; questions: number }[]
        }>(request(owner, '/study/where'))
        assert.deepEqual(
          where.viewed.slice(0, 2).map((v) => v.id),
          [lecture.id, visViva.id],
          'Most recently opened first',
        )
        assert.deepEqual([where.threads[0]?.id, where.threads[0]?.mode], [thread.id, 'tutor'])
        assert.deepEqual(
          where.topics.map((x) => [x.pageId, x.title, x.questions]),
          [[lecture.id, 'Orbital transfers', 1]],
        )
        assert.deepEqual((await ok<{ viewed: unknown[] }>(request(outsider, '/study/where'))).viewed, [])
      },
    )

    await t.test('a quick check is kept with the answer, so asking again costs nothing', async () => {
      const kept = {
        questions: [{ question: 'Why not one burn?', answer: 'One burn returns to the start.' }],
        usage: null,
      }
      await db.update(schema.aiMessages).set({ quickCheck: kept }).where(eq(schema.aiMessages.id, answerId))
      assert.deepEqual(await ok(send(owner, 'POST', `/ai/messages/${answerId}/quick-check`, {})), kept)
      assert.equal((await send(outsider, 'POST', `/ai/messages/${answerId}/quick-check`, {})).status, 404)
    })

    await t.test('exam plans: proposed in one call, dated and linked in code, edited, shared', async () => {
      const study = await import('../services/study')
      let planPrompt = ''
      const fakePlan = (async (req: { messages: { content: unknown }[] }) => {
        planPrompt = JSON.stringify(req.messages)
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
      const ask = (o: Partial<Parameters<typeof study.generateExamPlan>[0]>) =>
        study.generateExamPlan(
          {
            userId: owner.id,
            courseId: source.id,
            courseName: 'Source course',
            examDate: '2026-11-09',
            today: '2026-11-06',
            minutesPerDay: 45,
            ...o,
          },
          fakePlan,
        )
      await assert.rejects(ask({ examDate: '2026-11-06' }), /between tomorrow/)
      const plan = await ask({})
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
      const scoped = await ask({
        examDate: '2026-11-12',
        minutesPerDay: 60,
        weekdays: [5, 1, 2, 3, 4],
        pages: [{ id: lecture.id, confidence: 'shaky' }],
      })
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
      const task = scoped.days[1]?.items[0]
      assert.ok(task)
      const tick = (actor: typeof owner, done: boolean) =>
        send(actor, 'PATCH', `/study/plans/${scoped.id}/items/${task.id}`, { done })
      assert.equal((await ok<typeof scoped>(tick(owner, true))).days[1]?.items[0]?.done, true)
      assert.equal((await tick(viewer, false)).status, 404)
      assert.match((await ok<{ today: string }>(request(owner, '/study/today'))).today, /^\d{4}-\d{2}-\d{2}$/)
      assert.equal((await request(owner, `/study/plans/${scoped.id}`, { method: 'DELETE' })).status, 204)

      // Pause and resume: a paused plan is kept, but left out of today's revision.
      const active = (actor: typeof owner, value: boolean) =>
        send(actor, 'PATCH', `/study/plans/${plan.id}`, { active: value })
      assert.equal((await ok<typeof plan>(active(owner, false))).active, false)
      assert.deepEqual(await study.todaysTasks(owner.id, '2026-11-07'), [])
      assert.equal((await active(viewer, true)).status, 404)
      await ok(active(owner, true))

      // Export, then import: into the same course the page links come back; elsewhere tasks keep the page title.
      const exported = await request(owner, `/study/plans/${plan.id}/export`)
      assert.match(
        exported.headers.get('content-disposition') ?? '',
        /attachment; filename="Transfers-exam\.plan\.json"/,
      )
      const file = await ok<{ format: string; courseName: string }>(exported)
      assert.deepEqual([file.format, file.courseName], ['notecyclopedia-exam-plan', 'Source course'])
      type Imported = { plan: typeof plan; linked: number; unlinked: number }
      const importInto = (courseId: string, actor = owner, planFile: unknown = file) =>
        send(actor, 'POST', '/study/plans/import', { courseId, plan: planFile })
      const same = await ok<Imported>(importInto(source.id), 201)
      assert.deepEqual([same.linked, same.unlinked], [1, 0])
      assert.equal(same.plan.days[0]?.items[0]?.pageId, firstPage.pageId)
      const other = await ok<Imported>(importInto(target.id), 201)
      assert.deepEqual([other.linked, other.unlinked], [0, 1])
      assert.equal(other.plan.days[0]?.items[0]?.pageTitle, firstPage.pageTitle)
      assert.equal((await importInto(source.id, outsider)).status, 404, 'Only into your own courses')
      assert.equal((await importInto(source.id, owner, { ...file, format: 'other' })).status, 400)

      // Share a copy with a member of the course; it becomes theirs only when they accept it.
      const shareWith = (userId: string) => send(owner, 'POST', `/study/plans/${plan.id}/share`, { userId })
      assert.equal((await shareWith(outsider.id)).status, 404, 'Only members of the course')
      assert.equal((await shareWith(owner.id)).status, 400)
      assert.equal((await shareWith(viewer.id)).status, 201)
      const incoming = await ok<{ id: string; fromName: string; title: string; tasks: number }[]>(
        request(viewer, '/study/shares'),
      )
      assert.deepEqual(
        incoming.map((s) => [s.fromName, s.title, s.tasks]),
        [['owner', 'Transfers exam', 2]],
      )
      assert.deepEqual(await ok(request(outsider, '/study/shares')), [])
      const shareId = incoming[0]?.id as string
      assert.equal(
        (await request(outsider, `/study/shares/${shareId}/accept`, { method: 'POST' })).status,
        404,
      )
      const copy = await ok<typeof plan>(
        request(viewer, `/study/shares/${shareId}/accept`, { method: 'POST' }),
        201,
      )
      assert.equal(copy.courseId, source.id)
      assert.equal(copy.days[0]?.items[0]?.pageId, firstPage.pageId)
      assert.ok(
        copy.days.every((d) => d.items.every((i) => !i.done)),
        'Progress is not shared',
      )
      assert.deepEqual(await ok(request(viewer, '/study/shares')), [])
      assert.equal((await request(owner, `/study/plans/${copy.id}`)).status, 404, 'The copy is private')
      // Declining removes the copy.
      await shareWith(viewer.id)
      const again = await ok<{ id: string }[]>(request(viewer, '/study/shares'))
      assert.equal((await request(viewer, `/study/shares/${again[0]?.id}`, { method: 'DELETE' })).status, 204)
      assert.deepEqual(await ok(request(viewer, '/study/shares')), [])
      assert.ok((await ok<{ id: string }[]>(request(owner, '/study/plans'))).some((p) => p.id === plan.id))
      assert.equal((await request(viewer, `/study/plans/${plan.id}`)).status, 404, 'Plans are private')

      // Edit: tick an item, move one to another day; a link to a page outside the course is dropped.
      const foreign = await api.createPage(owner, { courseId: target.id, title: 'Elsewhere' })
      const saved = await ok<typeof plan>(
        send(owner, 'PUT', `/study/plans/${plan.id}`, {
          title: 'Transfers exam (edited)',
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
      )
      assert.deepEqual(
        saved.days.map((d) => [d.date, d.items.map((i) => [i.focus, i.done, i.pageId === null])]),
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
      assert.equal((await send(viewer, 'PUT', `/study/plans/${plan.id}`, saved)).status, 404)

      // A task links to a lecture and to the user's own calculators (a classmate's is dropped).
      const own = await api.createCalculator(owner, 'Transfer Δv')
      const classmates = await api.createCalculator(editor, 'Editor’s calculator', { courseId: source.id })
      const linkedTask = saved.days[1]?.items[0]
      assert.ok(linkedTask)
      const linked = await ok<typeof plan>(
        send(owner, 'PUT', `/study/plans/${plan.id}`, {
          ...saved,
          days: [
            saved.days[0],
            {
              date: '2026-11-08',
              items: [{ ...linkedTask, lectureNumber: 2, calculatorIds: [own.id, classmates.id] }],
            },
          ],
        }),
      )
      assert.deepEqual(
        [linked.days[1]?.items[0]?.lectureNumber, linked.days[1]?.items[0]?.calculatorIds],
        [2, [own.id]],
      )
      assert.equal((await request(owner, `/study/plans/${plan.id}`, { method: 'DELETE' })).status, 204)
    })
  },
)
