import { type Page, expect, test } from '@playwright/test'

/** Answers the chat stream (Claude is not called in tests) and records what was asked. */
async function fakeChat(page: Page, answer: string, citations: unknown[] = []) {
  const asked: { mode: string; message: string; pageIds?: string[] }[] = []
  await page.route('**/api/ai/chat', async (route) => {
    asked.push(route.request().postDataJSON())
    const events = [
      { type: 'thread', threadId: crypto.randomUUID() },
      { type: 'citations', citations },
      { type: 'text', text: answer },
      {
        type: 'usage',
        usage: {
          models: ['claude-haiku-5-5'],
          inputTokens: 2000,
          outputTokens: 150,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.0003,
        },
      },
      { type: 'done', messageId: crypto.randomUUID() },
    ]
    await route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
    })
  })
  return asked
}

test('ask about a selection or a formula while reading, and keep the answer in the page', async ({
  page,
}, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Reader')
  await page.getByLabel('Email').fill(`reader-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })).json()) as {
      id: string
    }
  ).id
  const visViva = 'v^2 = \\mu \\left(\\frac{2}{r} - \\frac{1}{a}\\right)'
  const create = async (title: string, content: unknown[]) =>
    (
      (await (
        await page.request.post('/api/pages', {
          data: { courseId, title, type: 'lecture', content: { type: 'doc', content } },
        })
      ).json()) as { id: string }
    ).id
  const lecture = await create('Vis-viva', [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Orbital speed depends only on the radius and a.' }],
    },
    { type: 'formula', attrs: { latex: visViva, label: '2.1' } },
  ])
  const other = await create('Orbital energy', [
    { type: 'formula', attrs: { latex: 'v^2=\\mu\\left(\\frac{2}{r}-\\frac{1}{a}\\right)' } },
  ])
  await page.request.post('/api/calculators', {
    data: {
      courseId,
      sourcePageId: lecture,
      spec: {
        version: 1,
        name: 'Vis-viva speed',
        inputs: [{ key: 'r', label: 'Radius', default: 7000 }],
        outputs: [{ key: 'v', label: 'Speed', expr: 'sqrt(398600 / r)' }],
      },
    },
  })

  // 1. Select a sentence and ask for an explanation: the page is the source.
  const asked = await fakeChat(page, 'Energy is conserved, so a **slower** satellite is farther out.')
  await page.goto(`/pages/${lecture}`)
  const sentence = page.getByText('Orbital speed depends only on the radius and a.')
  await sentence.selectText()
  const toolbar = page.getByRole('toolbar', { name: 'Ask about this' })
  await toolbar.getByRole('button', { name: 'Explain' }).click()
  const panel = page.getByRole('complementary', { name: 'Help with this page' })
  await expect(panel.getByText('satellite is farther out.')).toBeVisible()
  expect(asked[0]?.pageIds).toEqual([lecture])
  expect(asked[0]?.message).toContain('Orbital speed depends only on the radius and a.')
  expect(asked).toHaveLength(1)
  await expect(panel.getByText('≈ $0.0003')).toBeVisible()

  // 2. Keep it: the answer opens in the editor as an unsaved addition, saved only with Save.
  await panel.getByRole('button', { name: 'Add to page' }).click()
  await expect(page).toHaveURL(`/pages/${lecture}/edit`)
  await expect(
    page.getByText('was added at the end of the page as an unsaved change', { exact: false }),
  ).toBeVisible()
  await expect(page.getByLabel('Page content').getByText('satellite is farther out.')).toBeVisible()
  await page.getByRole('button', { name: 'Save revision' }).click()
  await expect(page).toHaveURL(`/pages/${lecture}`)
  await expect(page.getByRole('heading', { name: /^Explain: Orbital speed depends/ })).toBeVisible()

  // 3. A formula opens its card: where else it appears, and the calculators from its page (no AI).
  await page.locator('[data-formula-node]').first().click()
  await expect(panel.getByRole('region', { name: 'About this formula' })).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Orbital energy' })).toHaveAttribute(
    'href',
    new RegExp(`/pages/${other}#`),
  )
  await expect(panel.getByRole('link', { name: 'Vis-viva speed' })).toBeVisible()
  // Nothing is asked until the reader chooses a question.
  expect(asked).toHaveLength(1)
  await panel.getByRole('button', { name: 'Why does this hold?' }).click()
  await expect.poll(() => asked.length).toBe(2)
  await page.screenshot({ path: testInfo.outputPath('formula-help.png') })
  expect(asked[1]?.message).toContain(`$$${visViva}$$`)
  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toHaveCount(0)
})

test('a tutor answer can be saved to a page it cites', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Portal reader')
  await page.getByLabel('Email').fill(`portal-${crypto.randomUUID()}@example.test`)
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
        data: { courseId, title: 'Hohmann transfers', type: 'lecture' },
      })
    ).json()) as { id: string }
  ).id

  await page.route('**/api/ai/status', (route) => route.fulfill({ json: { configured: true } }))
  await fakeChat(page, 'Two burns: one to leave, one to circularise.', [
    { sourceType: 'page', sourceId: pageId, title: 'Hohmann transfers' },
  ])
  await page.goto('/ai')
  await page.getByLabel('Message').fill('Why two burns?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByText('one to circularise.')).toBeVisible()
  await page.getByLabel('Save to page…').selectOption(pageId)
  await expect(page).toHaveURL(`/pages/${pageId}/edit`)
  await expect(page.getByLabel('Page content').getByText('one to circularise.')).toBeVisible()
  await expect(page.getByLabel('Page content').getByRole('heading', { name: 'Why two burns?' })).toBeVisible()
})
