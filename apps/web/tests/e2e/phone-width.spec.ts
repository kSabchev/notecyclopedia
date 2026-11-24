import { type Page, expect, test } from '@playwright/test'

// Phone width (360 px): no screen scrolls sideways, and long names wrap instead of being cut off or squeezing
// what is next to them. The names here are long on purpose.
const LONG_COURSE = 'Astrodynamics and spacecraft mission design'
const LONG_PLAN = 'Astrodynamics final exam revision plan for the winter session'
const LONG_TASK = 'Read the Hohmann transfer page and rework the two-burn example'
const text = (t: string) => ({ type: 'text', text: t })
const calculator = {
  version: 1,
  name: 'Hohmann transfer between circular orbits',
  inputs: [
    { key: 'r1', label: 'Initial orbit radius', unit: 'km', default: 6678 },
    { key: 'r2', label: 'Target orbit radius', unit: 'km', default: 42164 },
  ],
  constants: { mu: 398600.4418 },
  outputs: [
    { key: 'at', label: 'Transfer semi-major axis', unit: 'km', expr: '(r1 + r2) / 2', precision: 1 },
    { key: 'v1', label: 'Initial circular speed', unit: 'km/s', expr: 'sqrt(mu / r1)', precision: 3 },
  ],
}

/** The page is no wider than the screen. */
async function fitsTheScreen(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
}

test('screens fit a phone, and long names wrap', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Phone')
  await page.getByLabel('Email').fill(`phone-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const post = async <T>(url: string, data: unknown) =>
    (await (await page.request.post(url, { data })).json()) as T
  const course = await post<{ id: string }>('/api/courses', { name: LONG_COURSE })
  const note = await post<{ id: string }>('/api/pages', {
    courseId: course.id,
    title: 'Hohmann transfers and phasing manoeuvres between geostationary slots',
    type: 'lecture',
    lectureNumber: 3,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            text('See https://en.wikipedia.org/wiki/Hohmann_transfer_orbit_and_bi_elliptic_transfer.'),
          ],
        },
        {
          type: 'formula',
          attrs: {
            id: 'f1',
            latex: '\\Delta v = \\sqrt{\\frac{\\mu}{r_1}}\\left(\\sqrt{\\frac{2 r_2}{r_1 + r_2}} - 1\\right)',
            label: 'Total Δv of a Hohmann transfer',
          },
        },
        { type: 'widget', attrs: { kind: 'calculator', spec: calculator } },
      ],
    },
  })
  const calc = await post<{ id: string }>('/api/calculators', { spec: calculator, courseId: course.id })
  const today = new Date().toLocaleDateString('en-CA')
  const { plan } = await post<{ plan: { id: string } }>('/api/study/plans/import', {
    courseId: course.id,
    plan: {
      format: 'notecyclopedia-exam-plan',
      version: 1,
      title: LONG_PLAN,
      examDate: '2099-01-01',
      days: [
        { date: today, items: [{ focus: LONG_TASK, page: { id: note.id, title: 'Hohmann transfers' } }] },
      ],
    },
  })

  // The reading view: the formula keeps a usable width, with its label under it.
  await page.goto(`/pages/${note.id}`)
  const formula = page.locator('[data-formula-node] .katex-display').first()
  await expect(formula).toBeVisible()
  expect((await formula.boundingBox())?.width).toBeGreaterThan(150)
  // The practice panel inside the page: its title is not squeezed by the buttons.
  await page.getByRole('button', { name: 'Practice problem' }).click()
  const practice = page.getByRole('region', { name: 'Practice problem' })
  expect((await practice.getByText('A problem like this one').boundingBox())?.width).toBeGreaterThan(150)
  await fitsTheScreen(page)

  // The plan: its title and tasks wrap rather than being cut off; the page dropdown fits.
  await page.goto(`/study/${plan.id}`)
  for (const box of [page.getByLabel('Plan title'), page.getByLabel('Task').first()]) {
    await expect(box).toBeVisible()
    const { scrollWidth, clientWidth } = await box.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
  }
  await expect(page.getByLabel('Plan title')).toHaveValue(LONG_PLAN)
  await fitsTheScreen(page)

  // Home's revision list, Lectures, Exam prep and the calculator library with its course filter.
  for (const url of ['/', '/lectures', '/study', '/calculators', `/calculators/${calc.id}`]) {
    await page.goto(url)
    await page.waitForLoadState('networkidle')
    await fitsTheScreen(page)
  }
  await page.goto('/')
  const task = page.getByText(LONG_TASK)
  expect((await task.boundingBox())?.width).toBeGreaterThan(200)
})
