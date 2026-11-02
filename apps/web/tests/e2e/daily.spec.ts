import { expect, test } from '@playwright/test'

// Claude is not called in tests: the daily-question API is answered here; the rest of the app is real.
test('today’s question is made on request, then answered, expanded, checked and saved', async ({
  page,
}, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Daily question user')
  await page.getByLabel('Email').fill(`daily-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })).json()) as {
      id: string
    }
  ).id
  const pageId = (
    (await (
      await page.request.post('/api/pages', {
        data: { courseId, title: 'Orbital manoeuvres', type: 'lecture', lectureNumber: 4 },
      })
    ).json()) as { id: string }
  ).id

  const question = {
    id: crypto.randomUUID(),
    day: '2026-11-02',
    courseId,
    pageId,
    pageTitle: 'Orbital manoeuvres',
    nodeId: null,
    topic: 'Hohmann transfer',
    question: 'Why does a **Hohmann transfer** need two burns?',
    answer: 'The first burn raises apoapsis to the target orbit; the second circularises there.',
    beyondNotes: null,
    expansions: {},
    usage: {
      models: ['claude-haiku-5-5'],
      inputTokens: 900,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.0002,
    },
    createdAt: new Date().toISOString(),
  }
  let generatedFor: { courseId?: string } | undefined
  let saved = false
  // Once generated, today's question is returned for the rest of the day.
  await page.route('**/api/daily/today', (route) => {
    if (route.request().method() !== 'POST')
      return route.fulfill({ json: { day: question.day, question: generatedFor ? question : null } })
    generatedFor = route.request().postDataJSON()
    return route.fulfill({ json: question })
  })
  await page.route(`**/api/daily/${question.id}/expand`, (route) =>
    route.fulfill({
      json: {
        ...question,
        expansions: { story: 'Walter Hohmann worked it out in 1925, long before spaceflight.' },
      },
    }),
  )
  await page.route(`**/api/daily/${question.id}/save`, (route) => {
    saved = true
    return route.fulfill({ json: { pageId } })
  })

  await page.goto('/')
  const card = page.getByRole('region', { name: "Today's question" })
  await card.getByLabel('Course for the question').selectOption(courseId)
  await card.getByRole('button', { name: 'Generate' }).click()
  await expect(card.getByText('need two burns?')).toBeVisible()
  expect(generatedFor).toEqual({ courseId, locale: 'en' })
  // The answer stays hidden until asked for.
  await expect(card.getByText('The first burn raises apoapsis')).toHaveCount(0)
  await card.getByRole('button', { name: 'Show answer' }).click()
  await expect(card.getByText('The first burn raises apoapsis')).toBeVisible()
  await expect(card.getByText('AI cost so far: ≈ $0.0002')).toBeVisible()

  await card.getByRole('button', { name: 'Tell it as a story' }).click()
  await expect(card.getByRole('region', { name: 'Story' })).toContainText('Walter Hohmann')
  await expect(card.getByRole('button', { name: 'Tell it as a story' })).toHaveCount(0)

  await card.screenshot({ path: testInfo.outputPath('daily.png') })
  await card.getByRole('button', { name: 'Save to page' }).click()
  await expect(card.getByRole('link', { name: /Saved to its page/ })).toBeVisible()
  expect(saved).toBe(true)

  // Your own question opens the tutor with the message started, not sent.
  await card.getByRole('link', { name: 'Ask your own question' }).click()
  await expect(page).toHaveURL(/\/ai\?/)
  await expect(page.getByLabel('Message')).toHaveValue(/^About today's question \("Why does a/)

  // Checking an answer goes to the tutor's "Check my working" mode with the question and the answer.
  await page.goto('/')
  await card.getByRole('button', { name: 'Check my answer' }).click()
  await card.getByLabel('My answer').fill('One burn to leave, one to arrive.')
  await card.getByRole('button', { name: 'Check with the tutor' }).click()
  await expect(page).toHaveURL(/mode=check/)
  expect(new URL(page.url()).searchParams.get('q')).toContain('My answer: One burn to leave, one to arrive.')

  // Today's question stays; the chosen course is remembered in this browser for the next one.
  await page.goto('/')
  await expect(card.getByText('need two burns?')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('nc.daily.course'))).toBe(courseId)
})

// Claude is not called in tests: making questions is answered here; the page, filters and paging are real.
test('the daily questions page makes questions on demand and lists them by day', async ({
  page,
}, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Question browser')
  await page.getByLabel('Email').fill(`daily-list-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const question = (n: number, day: string, topic: string) => ({
    id: crypto.randomUUID(),
    day,
    courseId: crypto.randomUUID(),
    pageId: null,
    pageTitle: 'Orbital manoeuvres',
    nodeId: null,
    topic,
    question: `Question ${n} about ${topic}?`,
    answer: `Answer ${n}.`,
    beyondNotes: null,
    expansions: {},
    usage: null,
    createdAt: new Date(2026, 10, n).toISOString(),
  })
  const stored = [
    question(2, '2026-11-01', 'Vis-viva equation'),
    question(1, '2026-10-31', 'Kepler’s third law'),
  ]
  const listed: string[] = []
  await page.route('**/api/daily/today', (route) =>
    route.fulfill({ json: { day: '2026-11-02', question: null } }),
  )
  await page.route(/\/api\/daily(\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      const made = question(3, '2026-11-02', 'Hohmann transfer')
      stored.unshift(made)
      return route.fulfill({ status: 201, json: made })
    }
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    listed.push(q)
    return route.fulfill({ json: stored.filter((x) => x.question.includes(q)) })
  })

  // The questions have their own place in the navigation.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Daily questions' }).click()
  await expect(page).toHaveURL('/daily')
  const all = page.getByRole('region', { name: 'All questions' })
  await expect(all.getByText('Question 2 about Vis-viva equation?')).toBeVisible()
  await expect(all.getByRole('region')).toHaveCount(2) // one section per day

  await page.getByRole('button', { name: 'Ask me a question' }).click()
  await expect(all.getByText('Question 3 about Hohmann transfer?')).toBeVisible()
  await expect(all.getByRole('region').first()).toContainText('Question 3')

  await page.screenshot({ path: testInfo.outputPath('daily-page.png'), fullPage: true })
  await page.getByLabel('Search questions').fill('Kepler')
  await expect(all.getByText('Question 2 about Vis-viva equation?')).toHaveCount(0)
  await expect(all.getByText('Question 1 about Kepler’s third law?')).toBeVisible()
  expect(listed).toContain('Kepler')
})
