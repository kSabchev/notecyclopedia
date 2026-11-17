import { expect, test } from '@playwright/test'

const text = (t: string) => ({ type: 'text', text: t })
const p = (t: string) => ({ type: 'paragraph', content: [text(t)] })
const h = (id: string, t: string) => ({ type: 'heading', attrs: { level: 2, id }, content: [text(t)] })

test('Review & polish can review the whole page or one section', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Reviewer')
  await page.getByLabel('Email').fill(`review-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })).json()) as {
      id: string
    }
  ).id
  const create = async (title: string, content: unknown[]) =>
    (await (
      await page.request.post('/api/pages', {
        data: { courseId, title, type: 'lecture', content: { type: 'doc', content } },
      })
    ).json()) as { id: string; revision: number; content: unknown }
  const kepler = await create('Kepler’s laws', [
    p('Three laws of planetary motion.'),
    h('h-first', 'First law'),
    p('Orbits are ellipses.'),
    h('h-second', 'Second law'),
    p('Equal areas in equal times.'),
  ])

  // Claude is mocked: the review returns the page with the second section reworded.
  const asked: unknown[] = []
  await page.route('**/api/ai/pages/*/review', async (route) => {
    asked.push(route.request().postDataJSON())
    const current = (await (await page.request.get(`/api/pages/${kepler.id}`)).json()) as {
      content: { content: unknown[] }
    }
    const content = [...current.content.content.slice(0, 4), p('A planet sweeps equal areas in equal times.')]
    await route.fulfill({
      json: {
        page: current,
        review: {
          findings: ['Second law: clearer wording.'],
          content: { type: 'doc', content },
          section: { id: 'h-second', title: 'Second law' },
        },
      },
    })
  })

  await page.goto(`/pages/${kepler.id}/review`)
  const choices = page.getByRole('group', { name: 'What should the AI review?' })
  await expect(choices.getByLabel('The whole page')).toBeChecked()
  await expect(choices.getByLabel('The opening (before the first heading)')).toBeVisible()
  await choices.getByLabel('Second law').check()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByText('Proposed changes to “Second law” of Kepler’s laws')).toBeVisible()
  expect(asked).toEqual([{ section: 'h-second' }])
  await expect(page.getByText('Second law: clearer wording.')).toBeVisible()

  // A page without headings has nothing to choose: its review starts at once.
  const short = await create('Short note', [p('One paragraph.')])
  await page.route('**/api/ai/pages/*/review', (route) => {
    asked.push(route.request().postDataJSON())
    return route.fulfill({
      status: 413,
      json: { error: 'This page is too long to review at once. Review it one section at a time.' },
    })
  })
  await page.goto(`/pages/${short.id}/review`)
  await expect(page.getByText('This page is too long to review at once.')).toBeVisible()
  expect(asked.at(-1)).toEqual({})
})
