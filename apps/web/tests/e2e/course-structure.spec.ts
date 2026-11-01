import { type APIRequestContext, expect, test } from '@playwright/test'

const formula = (latex: string, description: string) => ({
  type: 'doc',
  content: [{ type: 'formula', attrs: { latex, description } }],
})

async function createPage(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post('/api/pages', { data })
  expect(response.ok()).toBe(true)
}

test('a course lists lectures, example problems and theory in sections, and formulas by subject', async ({
  page,
}, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Course structure user')
  await page.getByLabel('Email').fill(`structure-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const course = async (name: string) =>
    ((await (await page.request.post('/api/courses', { data: { name } })).json()) as { id: string }).id
  const dynamics = await course('Orbital dynamics')
  const physics = await course('Physics')
  // Created out of order: the sections sort them.
  await createPage(page.request, {
    courseId: dynamics,
    title: 'Orbital transfers',
    type: 'lecture',
    lectureNumber: 2,
    content: formula('\\Delta v = v_2 - v_1', 'Velocity change'),
  })
  await createPage(page.request, {
    courseId: dynamics,
    title: 'Hohmann to GEO',
    type: 'seminar',
    lectureNumber: 2,
  })
  await createPage(page.request, {
    courseId: dynamics,
    title: 'Two-body problem',
    type: 'lecture',
    lectureNumber: 1,
    content: formula('v = \\sqrt{\\mu / r}', 'Circular speed'),
  })
  await createPage(page.request, {
    courseId: dynamics,
    title: 'Circular orbit speed',
    type: 'seminar',
    lectureNumber: 1,
  })
  await createPage(page.request, {
    courseId: dynamics,
    title: 'Escape speed',
    type: 'seminar',
    lectureNumber: 1,
  })
  await createPage(page.request, { courseId: dynamics, title: 'Kepler orbits', type: 'theory' })
  await createPage(page.request, {
    courseId: physics,
    title: 'Kinematics',
    type: 'lecture',
    lectureNumber: 1,
    content: formula('v = v_0 + a t', 'Final speed'),
  })

  await page.goto(`/courses/${dynamics}`)
  const lectures = page.locator('details', { has: page.getByRole('heading', { name: 'Lectures' }) })
  await expect(lectures.getByRole('link')).toHaveText([
    /Lecture 1\s*Two-body problem\s*2 example problems/,
    /Lecture 2\s*Orbital transfers\s*1 example problem/,
  ])
  // Example problems are listed under the lecture they practise.
  const problems = page.locator('details', { has: page.getByRole('heading', { name: 'Example problems' }) })
  await expect(problems.getByRole('listitem')).toHaveText([
    /^Lecture 1\s*Circular orbit speed/,
    /^Escape speed/,
    /^Lecture 2\s*Hohmann to GEO/,
  ])
  await expect(page.getByRole('heading', { name: 'Theory' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Notes' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('course.png'), fullPage: true })

  await page.goto('/formulas')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([/Orbital dynamics\s*2/, /Physics\s*1/])
  const dynamicsFormulas = page.getByRole('region', { name: /Orbital dynamics/ })
  await expect(dynamicsFormulas.getByText('Lecture 1')).toBeVisible()
  await expect(dynamicsFormulas.getByText('Lecture 2')).toBeVisible()
  await page.getByRole('button', { name: 'Physics', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([/Physics\s*1/])
  await expect(page.getByText('Final speed')).toBeVisible()
  await expect(page.getByText('Circular speed')).toHaveCount(0)
})
