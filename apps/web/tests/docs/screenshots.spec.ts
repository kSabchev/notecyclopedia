import path from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * The screenshots in docs/images, taken from sample data in a fresh test account (`pnpm docs:screenshots`). Rerun after
 * a visible change to the reading view or the orbit viewer, and check the images before committing them.
 */
const out = path.resolve(import.meta.dirname, '../../../../docs/images')
const text = (t: string) => ({ type: 'text', text: t })
const math = (latex: string) => ({ type: 'mathInline', attrs: { latex } })
const p = (...content: unknown[]) => ({ type: 'paragraph', content })

test('documentation screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Student')
  await page.getByLabel('Email').fill(`docs-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const course = await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })
  const courseId = ((await course.json()) as { id: string }).id
  const created = await page.request.post('/api/pages', {
    data: {
      courseId,
      title: 'Orbital transfers',
      type: 'lecture',
      lectureNumber: 3,
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [text('Hohmann transfer')] },
          p(
            text('The cheapest two-burn transfer between circular orbits of radii '),
            math('r_1'),
            text(' and '),
            math('r_2'),
            text(' follows an ellipse tangent to both, with semi-major axis '),
            math('a_{\\text{t}} = (r_1 + r_2)/2'),
            text('. Each burn changes the speed given by the vis-viva equation:'),
          ),
          {
            type: 'formula',
            attrs: {
              latex: 'v = \\sqrt{\\mu \\left( \\frac{2}{r} - \\frac{1}{a} \\right)}',
              label: '3.1',
              description: 'Speed at radius r on an orbit with semi-major axis a',
            },
          },
          { type: 'heading', attrs: { level: 2 }, content: [text('A Molniya orbit')] },
          p(
            text('At the critical inclination '),
            math('i = 63.4^\\circ'),
            text(' the periapsis does not drift under J2.'),
          ),
          {
            type: 'widget',
            attrs: {
              kind: 'orbit',
              body: 'earth',
              elements: { a: 26600, e: 0.74, i: 63.4, raan: 0, argp: 270, nu: 0 },
            },
          },
        ],
      },
    },
  })
  const pageId = ((await created.json()) as { id: string }).id

  await page.goto(`/pages/${pageId}`)
  await expect(page.getByRole('heading', { name: 'Orbital transfers' })).toBeVisible()
  await expect(page.locator('.katex').first()).toBeVisible()
  // The orbit block loads on its own; wait for its controls.
  await expect(page.getByLabel('Central body')).toBeVisible()
  await page.screenshot({ path: path.join(out, 'page-view.png') })

  await page.goto('/orbit?a=26600&e=0.74&i=63.4&argp=270')
  await expect(page.getByRole('heading', { name: 'Orbit viewer' })).toBeVisible()
  await expect(page.getByText(/^Orbital plane:/)).toBeVisible()
  await page.screenshot({ path: path.join(out, 'orbit-viewer.png') })
})
