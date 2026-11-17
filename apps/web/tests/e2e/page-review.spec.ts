import { expect, test } from '@playwright/test'

const text = (t: string) => ({ type: 'text', text: t })
const p = (t: string) => ({ type: 'paragraph', content: [text(t)] })
const h = (id: string, t: string) => ({ type: 'heading', attrs: { level: 2, id }, content: [text(t)] })

test('Review & polish can review the whole page or one or more sections', async ({ page }) => {
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
    { type: 'heading', attrs: { level: 3, id: 'h-area' }, content: [text('Areal velocity')] },
    p('Constant along the orbit.'),
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
          sections: [
            { id: 'h-first', title: 'First law' },
            { id: 'h-second', title: 'Second law' },
          ],
        },
      },
    })
  })

  await page.goto(`/pages/${kepler.id}/review`)
  const choices = page.getByRole('group', { name: 'What should the AI review?' })
  await expect(choices.getByLabel('The whole page')).toBeChecked()
  await expect(choices.getByLabel('The opening (before the first heading)')).not.toBeChecked()
  // Ticking sections replaces the whole page; a subsection of a ticked section is already included.
  await choices.getByLabel('First law').check()
  await expect(choices.getByLabel('The whole page')).not.toBeChecked()
  await choices.getByLabel('Second law').check()
  await expect(choices.getByLabel('Areal velocity')).toBeChecked()
  await expect(choices.getByLabel('Areal velocity')).toBeDisabled()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByText('Proposed changes to “First law”, “Second law” of Kepler’s laws')).toBeVisible()
  expect(asked).toEqual([{ sections: ['h-first', 'h-second'] }])
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

test('Review & polish keeps the current and proposed versions aligned by heading', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Aligner')
  await page.getByLabel('Email').fill(`align-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Orbits' } })).json()) as { id: string }
  ).id
  // Six sections; the proposal makes each one twice as long, so the two sides differ in height.
  const section = (n: number, paragraphs: number) => [
    h(`s${n}`, `Section ${n}`),
    ...Array.from({ length: paragraphs }, (_, i) => p(`Paragraph ${i + 1} of section ${n}.`)),
  ]
  const original = [1, 2, 3, 4, 5, 6].flatMap((n) => section(n, 4))
  const proposed = [1, 2, 3, 4, 5, 6].flatMap((n) => section(n, 8))
  const created = (await (
    await page.request.post('/api/pages', {
      data: { courseId, title: 'Long page', type: 'lecture', content: { type: 'doc', content: original } },
    })
  ).json()) as { id: string }
  await page.route('**/api/ai/pages/*/review', async (route) => {
    const current = await (await page.request.get(`/api/pages/${created.id}`)).json()
    await route.fulfill({
      json: {
        page: current,
        review: {
          findings: [],
          content: { type: 'doc', content: proposed },
          sections: [4, 5, 6].map((n) => ({ id: `s${n}`, title: `Section ${n}` })),
        },
      },
    })
  })

  await page.goto(`/pages/${created.id}/review`)
  for (const n of [4, 5, 6]) await page.getByRole('group').getByLabel(`Section ${n}`).check()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  const left = page.getByTestId('review-original')
  const right = page.getByTestId('review-proposed')
  // Where a heading sits within its pane.
  const offset = (pane: typeof left, id: string) =>
    pane.evaluate(
      (el, headingId) =>
        (el.querySelector(`[id="${headingId}"]`) as HTMLElement).getBoundingClientRect().top -
        el.getBoundingClientRect().top,
      id,
    )
  // Both panes start at the same height, and open at the first reviewed section.
  expect(Math.abs((await left.boundingBox())!.y - (await right.boundingBox())!.y)).toBeLessThan(2)
  await expect.poll(() => offset(left, 's4')).toBeLessThan(40)
  await expect
    .poll(async () => Math.abs((await offset(left, 's4')) - (await offset(right, 's4'))))
    .toBeLessThan(3)

  // Scrolling either side brings the same heading to the same height on the other.
  const toLine = (pane: typeof left, id: string) =>
    pane.evaluate((el, headingId) => {
      const heading = el.querySelector(`[id="${headingId}"]`) as HTMLElement
      el.scrollTop += heading.getBoundingClientRect().top - el.getBoundingClientRect().top - 24
    }, id)
  await toLine(left, 's2')
  await expect
    .poll(async () => Math.abs((await offset(left, 's2')) - (await offset(right, 's2'))))
    .toBeLessThan(3)
  await toLine(right, 's5')
  await expect
    .poll(async () => Math.abs((await offset(left, 's5')) - (await offset(right, 's5'))))
    .toBeLessThan(3)
})
