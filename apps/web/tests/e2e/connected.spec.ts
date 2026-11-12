import { expect, test } from '@playwright/test'

test('pages, lectures, exam prep tasks, calculators and courses link to one another', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Navigator')
  await page.getByLabel('Email').fill(`connected-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const post = async <T>(url: string, data: unknown) =>
    (await (await page.request.post(url, { data })).json()) as T
  const { id: courseId } = await post<{ id: string }>('/api/courses', { name: 'Astrodynamics' })
  const pageOf = (title: string, type: string, lectureNumber: number | null) =>
    post<{ id: string }>('/api/pages', {
      courseId,
      title,
      type,
      lectureNumber,
      content: { type: 'doc', content: [] },
    })
  const kepler = await pageOf('Kepler orbits', 'lecture', 1)
  await pageOf('Kepler notes', 'note', 1)
  await page.request.post('/api/files', {
    multipart: {
      courseId,
      lectureNumber: '1',
      files: { name: 'lecture-1.txt', mimeType: 'text/plain', buffer: Buffer.from('Kepler orbits: slides') },
    },
  })
  const calc = (name: string, courseTag: string | null, lectureNumber: number | null) =>
    post<{ id: string }>('/api/calculators', {
      courseId: courseTag,
      lectureNumber,
      spec: {
        version: 1,
        name,
        inputs: [{ key: 'a', label: 'Semi-major axis', unit: 'km', default: 7000 }],
        constants: { mu: 398600.4418 },
        constantMetadata: { mu: { name: 'Gravitational parameter', symbol: 'μ', unit: 'km³/s²' } },
        outputs: [{ key: 'T', label: 'Period', unit: 's', expr: '2 * pi * sqrt(a^3 / mu)' }],
      },
    })
  const period = await calc('Orbital period', courseId, 1)
  await calc('Hohmann Δv', null, null)
  const today = new Date().toLocaleDateString('en-CA')
  const { plan } = await post<{ plan: { id: string } }>('/api/study/plans/import', {
    courseId,
    plan: {
      format: 'notecyclopedia-exam-plan',
      version: 1,
      title: 'Astro final',
      examDate: '2099-01-01',
      days: [
        {
          date: today,
          items: [
            { focus: 'Read Kepler', page: { id: kepler.id, title: 'Kepler orbits' } },
            { focus: 'Practise transfers' },
          ],
        },
      ],
    },
  })

  // A page shows what it is connected to: its lecture, the lecture's other pages, calculators and tasks.
  await page.goto(`/pages/${kepler.id}`)
  const connected = page.getByRole('region', { name: 'Connected' })
  await expect(connected.getByRole('link', { name: 'Kepler notes' })).toBeVisible()
  await expect(connected.getByRole('link', { name: 'Orbital period' })).toBeVisible()
  await expect(connected.getByRole('link', { name: 'Read Kepler' })).toHaveAttribute(
    'href',
    `/study/${plan.id}`,
  )
  await connected.getByRole('link', { name: 'Lecture 1' }).click()
  await expect(page).toHaveURL(new RegExp(`/lectures#lecture-${courseId}-1$`))
  const card = page.getByRole('listitem', { name: 'Lecture 1' })
  await expect(card).toBeInViewport()
  await expect(card).toHaveClass(/border-accent/)
  await expect(card.getByRole('link', { name: 'Read Kepler' })).toBeVisible()

  // A task is linked to a lecture and calculators from the plan.
  await card.getByRole('link', { name: 'Read Kepler' }).click()
  await expect(page).toHaveURL(`/study/${plan.id}`)
  await page.getByRole('button', { name: 'Link “Practise transfers” to a lecture and calculators' }).click()
  await page.getByLabel('Lecture', { exact: true }).selectOption({ label: 'Lecture 1' })
  await page.getByRole('checkbox', { name: 'Hohmann Δv' }).check()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  // The task's own row (the day around it is a list item too).
  const task = page
    .getByRole('listitem')
    .filter({ has: page.getByLabel('Practise transfers', { exact: true }) })
    .last()
  await expect(task.getByRole('link', { name: 'Lecture 1' })).toBeVisible()
  await expect
    .poll(async () => {
      const saved = (await (await page.request.get(`/api/study/plans/${plan.id}`)).json()) as {
        days: { items: { focus: string; lectureNumber?: number; calculatorIds?: string[] }[] }[]
      }
      const item = saved.days[0]?.items.find((i) => i.focus === 'Practise transfers')
      return [item?.lectureNumber, item?.calculatorIds?.length]
    })
    .toEqual([1, 1])
  await task.getByRole('link', { name: 'Hohmann Δv' }).click()
  await expect(
    page.getByRole('region', { name: 'Connected' }).getByRole('link', { name: 'Practise transfers' }),
  ).toBeVisible()

  // A calculator names its course and lecture as links; the course page leads to its lectures, calculators and plans.
  await page.goto(`/calculators/${period.id}`)
  const detail = page.getByRole('region', { name: 'Orbital period' })
  await expect(detail.getByRole('link', { name: 'Lecture 1', exact: true }).first()).toHaveAttribute(
    'href',
    `/lectures#lecture-${courseId}-1`,
  )
  await detail.getByRole('link', { name: 'Astrodynamics', exact: true }).click()
  await expect(page).toHaveURL(`/courses/${courseId}`)
  await expect(page.getByRole('link', { name: /Lectures\s*1 original/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Astro final' })).toHaveAttribute('href', `/study/${plan.id}`)
  await page.getByRole('link', { name: /Calculators\s*1 calculator/ }).click()
  await expect(page).toHaveURL(new RegExp(`/calculators\\?course=${courseId}`))
  const list = page.getByRole('region', { name: 'Calculators' })
  await expect(list.getByRole('link').filter({ hasText: /=/ })).toHaveText([/Orbital period/])
})
