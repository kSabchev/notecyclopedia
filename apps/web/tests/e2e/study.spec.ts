import { type Page, expect, test } from '@playwright/test'

async function signUp(page: Page, name: string) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(`study-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })).json()) as {
      id: string
    }
  ).id
  const create = async (title: string) =>
    (
      (await (
        await page.request.post('/api/pages', { data: { courseId, title, type: 'lecture' } })
      ).json()) as { id: string }
    ).id
  return { courseId, create }
}

test('where was I: the pages you opened, most recent first', async ({ page }) => {
  const { create } = await signUp(page, 'Returning reader')
  const kepler = await create('Kepler orbits')
  const hohmann = await create('Hohmann transfers')

  await page.goto(`/pages/${kepler}`)
  await expect(page.getByRole('heading', { name: 'Kepler orbits' })).toBeVisible()
  await page.goto(`/pages/${hohmann}`)
  await expect(page.getByRole('heading', { name: 'Hohmann transfers' })).toBeVisible()

  await page.getByRole('link', { name: 'Home' }).click()
  const where = page.getByRole('region', { name: 'Where was I' })
  const opened = where.getByRole('list', { name: 'Recently opened' }).getByRole('link')
  await expect(opened).toHaveCount(2)
  await expect(opened.first()).toContainText('Hohmann transfers')
  await expect(opened.first()).toContainText('opened')
  await expect(where.getByText('Your questions to the AI appear here.')).toBeVisible()
  await expect(where.getByText('Pages your answers came from appear here.')).toBeVisible()
})

test('exam prep: a plan is proposed once, then caught up, moved, ticked off and added to', async ({
  page,
}, testInfo) => {
  const { courseId, create } = await signUp(page, 'Exam student')
  const kepler = await create('Kepler orbits')
  const hohmann = await create('Hohmann transfers')

  // Claude is not called in tests: the plan endpoints are answered here, from memory.
  type Day = { date: string; items: { focus: string; done: boolean; pageId: string | null }[] }
  const proposals: unknown[] = []
  const saves: { examDate: string; days: Day[] }[] = []
  let plan: Record<string, unknown> | null = null
  const today = new Date().toLocaleDateString('en-CA')
  const day = (n: number) => {
    const d = new Date(`${today}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  }
  const weekdayOf = (n: number) =>
    new Date(`${day(n)}T12:00:00Z`).toLocaleDateString('en', { weekday: 'long', timeZone: 'UTC' })
  const item = (focus: string, pageId: string | null, pageTitle: string | null) => ({
    id: crypto.randomUUID(),
    pageId,
    pageTitle,
    focus,
    done: false,
  })
  // An earlier exam of the same course, already behind: listed apart, and not a reason to warn.
  const pastPlan = {
    id: crypto.randomUUID(),
    courseId,
    title: 'Midterm',
    examDate: day(-10),
    studyWeekdays: [0, 1, 2, 3, 4, 5, 6],
    active: true,
    days: [{ date: day(-12), items: [{ ...item('Old task', null, null), done: true }] }],
    usage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  /** The tasks of a day in the last saved plan. */
  const savedOn = (n: number) =>
    saves
      .at(-1)
      ?.days.find((d) => d.date === day(n))
      ?.items.map((i) => i.focus)
  await page.route('**/api/study/plans**', async (route) => {
    const request = route.request()
    const method = request.method()
    if (method === 'POST') {
      proposals.push(request.postDataJSON())
      plan = {
        id: crypto.randomUUID(),
        courseId,
        title: 'Astrodynamics exam',
        examDate: day(4),
        studyWeekdays: [0, 1, 2, 3, 4, 5, 6],
        active: true,
        days: [
          // A day already behind: its task was not done.
          { date: day(-1), items: [item('Formulas from yesterday', null, null)] },
          { date: day(0), items: [item('Read the lecture', kepler, 'Kepler orbits')] },
          { date: day(1), items: [item('Rework the transfer examples', hohmann, 'Hohmann transfers')] },
          { date: day(2), items: [item('Practice run', null, null)] },
        ],
        usage: { costUsd: 0.0021 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      return route.fulfill({ status: 201, json: plan })
    }
    if (method === 'PUT') {
      const body = request.postDataJSON()
      saves.push(body)
      plan = { ...plan, ...body }
      return route.fulfill({ json: plan })
    }
    if (method === 'DELETE') {
      plan = null
      return route.fulfill({ status: 204, body: '' })
    }
    return route.fulfill({
      json: request.url().endsWith('/plans') ? [...(plan ? [plan] : []), pastPlan] : plan,
    })
  })

  // Make it: no study on Sundays, and only the Kepler lecture is in the exam, marked shaky.
  await page.getByRole('link', { name: 'Exam prep' }).click()
  await expect(page.getByText('Past exam (1)')).toBeVisible()
  await expect(page.getByRole('link', { name: /Midterm/ })).toBeHidden()
  await expect(page.getByText('This course already has a plan')).toHaveCount(0)
  await page.getByLabel('Exam date').fill(day(4))
  await page.getByLabel('Minutes a day').fill('45')
  // The weekday chips are labels around visually hidden checkboxes: click the chip, as a reader would.
  await page.locator('label').filter({ hasText: /^Sun$/ }).click()
  await expect(page.getByRole('checkbox', { name: 'Sun', exact: true })).not.toBeChecked()
  await page.getByText('Exam scope and how well you know each page').click()
  await expect(page.getByText('2 of 2 pages in scope')).toBeVisible()
  await page.getByRole('checkbox', { name: 'In the exam: Hohmann transfers' }).uncheck()
  await page.getByLabel('How well you know Kepler orbits').selectOption('shaky')
  await expect(page.getByText('1 of 2 pages in scope')).toBeVisible()
  await page.getByLabel('Anything to keep in mind').fill('weak on transfers')
  await page.getByRole('button', { name: 'Propose a plan' }).click()
  await expect(page.getByRole('textbox', { name: 'Plan title' })).toHaveValue('Astrodynamics exam')
  expect(proposals).toEqual([
    {
      courseId,
      examDate: day(4),
      minutesPerDay: 45,
      weekdays: [1, 2, 3, 4, 5, 6],
      pages: [{ id: kepler, confidence: 'shaky' }],
      note: 'weak on transfers',
      locale: 'en',
    },
  ])
  await expect(page.getByText('4 days to go')).toBeVisible()
  await expect(page.locator('header').getByText('Astrodynamics', { exact: true })).toBeVisible()
  // Renaming: edit the title and press Enter.
  await page.getByRole('textbox', { name: 'Plan title' }).fill('Astro final')
  await page.keyboard.press('Enter')
  await expect.poll(() => (saves.at(-1) as { title?: string } | undefined)?.title).toBe('Astro final')
  await expect(page.getByText('0 of 4 done')).toBeVisible()
  await expect(page.getByText('Today', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Kepler orbits' })).toHaveAttribute('href', `/pages/${kepler}`)

  // Tick off today's task.
  await page.getByRole('checkbox', { name: 'Read the lecture' }).check()
  await expect(page.getByText('1 of 4 done')).toBeVisible()
  expect(saves.at(-1)?.days.find((d) => d.date === day(0))?.items[0]?.done).toBe(true)

  // Catch up: yesterday's task moves to the least busy day left (today: its only task is done).
  await expect(page.getByText('1 task from earlier days is not done.')).toBeVisible()
  await page.getByRole('button', { name: 'Catch up' }).click()
  await expect(page.getByText('1 task from earlier days is not done.')).toHaveCount(0)
  expect(savedOn(-1)).toBeUndefined()
  expect(savedOn(0)).toEqual(['Read the lecture', 'Formulas from yesterday'])

  // Move the practice run to a day that has no tasks yet.
  const practice = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('checkbox', { name: 'Practice run' }) })
  await practice.getByLabel('Move to').selectOption(day(3))
  await expect.poll(() => savedOn(3)).toEqual(['Practice run'])
  expect(savedOn(2)).toBeUndefined()
  await expect(page.getByRole('listitem', { name: new RegExp(`^${weekdayOf(3)}`) })).toBeVisible()

  // Add a task with a page.
  const tomorrow = page.getByRole('listitem', { name: new RegExp(`^${weekdayOf(1)}`) })
  await tomorrow.getByRole('textbox', { name: /Add a task/ }).fill('Mock exam, 90 minutes')
  await tomorrow.getByLabel('Page').selectOption(hohmann)
  await tomorrow.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByRole('checkbox', { name: 'Mock exam, 90 minutes' })).toBeVisible()
  expect(
    saves
      .at(-1)
      ?.days.find((d) => d.date === day(1))
      ?.items.at(-1),
  ).toEqual(expect.objectContaining({ focus: 'Mock exam, 90 minutes', pageId: hohmann, done: false }))

  // The exam moves earlier: the tasks now on or after it are moved before it on request.
  await page.getByLabel('Exam date').fill(day(2))
  await expect(page.getByText('1 task is on or after the exam day.')).toBeVisible()
  await page.getByRole('button', { name: 'Move before the exam' }).click()
  await expect(page.getByText('1 task is on or after the exam day.')).toHaveCount(0)
  expect(saves.at(-1)?.examDate).toBe(day(2))
  expect(saves.at(-1)?.days.every((d) => d.date < day(2))).toBe(true)
  expect(
    saves
      .at(-1)
      ?.days.flatMap((d) => d.items.map((i) => i.focus))
      .sort(),
  ).toEqual([
    'Formulas from yesterday',
    'Mock exam, 90 minutes',
    'Practice run',
    'Read the lecture',
    'Rework the transfer examples',
  ])
  await page.screenshot({ path: testInfo.outputPath('exam-plan.png'), fullPage: true })
  expect(proposals).toHaveLength(1)

  // The plan is listed with its progress. Proposing another plan for the same course warns first (no call yet).
  await page.getByRole('link', { name: 'All plans' }).click()
  await expect(page.getByRole('link', { name: /Astro final/ })).toContainText('1 of 5 done')
  await expect(page.getByText('This course already has a plan for an exam on')).toContainText('Astro final')
  await expect(page.getByRole('button', { name: 'Propose another plan' })).toBeVisible()
  expect(proposals).toHaveLength(1)
  await page.getByText('Past exam (1)').click()
  await expect(page.getByRole('link', { name: /Midterm/ })).toContainText('Exam date passed')
  // Deleting asks first.
  await page.getByRole('link', { name: /Astro final/ }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete plan' }).click()
  await expect(page).toHaveURL('/study')
  await expect(page.getByRole('link', { name: /Astro final/ })).toHaveCount(0)
  await expect(page.getByText('This course already has a plan')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Propose a plan' })).toBeVisible()
})

test("today's revision on the home page: today's tasks ticked off in place", async ({ page }) => {
  await signUp(page, 'Home student')
  const planId = crypto.randomUUID()
  const taskId = crypto.randomUUID()
  const ticks: unknown[] = []
  await page.route('**/api/study/today', (route) =>
    route.fulfill({
      json: {
        today: new Date().toLocaleDateString('en-CA'),
        plans: [
          {
            planId,
            title: 'Astrodynamics exam',
            examDate: '2099-01-01',
            items: [
              {
                id: taskId,
                pageId: null,
                pageTitle: null,
                focus: 'Rework the transfer examples',
                done: false,
              },
            ],
            overdue: 2,
          },
        ],
      },
    }),
  )
  await page.route(`**/api/study/plans/${planId}/items/${taskId}`, (route) => {
    ticks.push(route.request().postDataJSON())
    return route.fulfill({ json: { id: planId, days: [] } })
  })
  await page.goto('/')
  const card = page.getByRole('region', { name: "Today's revision" })
  await expect(card.getByText('Astrodynamics exam')).toBeVisible()
  await expect(card.getByRole('link', { name: '2 earlier tasks to catch up' })).toHaveAttribute(
    'href',
    `/study/${planId}`,
  )
  await card.getByRole('checkbox', { name: 'Rework the transfer examples' }).check()
  await expect.poll(() => ticks).toEqual([{ done: true }])
})

test('quick check: questions about an answer only when asked, answers hidden until shown', async ({
  page,
}) => {
  await signUp(page, 'Checker')
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: { configured: true } }))
  const messageId = crypto.randomUUID()
  await page.route('**/api/ai/chat', (route) =>
    route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: [
        { type: 'thread', threadId: crypto.randomUUID() },
        { type: 'citations', citations: [] },
        { type: 'text', text: 'Two burns: one to leave, one to circularise.' },
        { type: 'done', messageId },
      ]
        .map((e) => `data: ${JSON.stringify(e)}\n\n`)
        .join(''),
    }),
  )
  let checks = 0
  await page.route(`**/api/ai/messages/${messageId}/quick-check`, (route) => {
    checks++
    return route.fulfill({
      json: {
        questions: [
          { question: 'Why is one burn not enough?', answer: 'It returns to where it started.' },
          { question: 'Which burn is larger for a higher target?', answer: 'The first.' },
        ],
        usage: { costUsd: 0.0008 },
      },
    })
  })
  await page.goto('/ai')
  await page.getByLabel('Message').fill('Why two burns?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByText('one to circularise.')).toBeVisible()
  expect(checks).toBe(0)

  await page.getByRole('button', { name: 'Check my understanding' }).click()
  const quick = page.getByRole('region', { name: 'Quick check' })
  await expect(quick.getByText('Why is one burn not enough?')).toBeVisible()
  await expect(quick.getByText('It returns to where it started.')).toHaveCount(0)
  await quick.getByRole('button', { name: 'Show answer' }).first().click()
  await expect(quick.getByText('It returns to where it started.')).toBeVisible()
  await expect(quick.getByText('≈ $0.0008')).toBeVisible()
  expect(checks).toBe(1)
})
