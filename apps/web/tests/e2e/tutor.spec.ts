import { expect, test } from '@playwright/test'

// A 1×1 PNG, standing in for a photo of handwritten working.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const calculator = {
  version: 1,
  name: 'Circular orbit',
  inputs: [
    { key: 'r', label: 'Radius', unit: 'km', default: 42164 },
    { key: 'mu', label: 'Gravitational parameter', unit: 'km3/s2', default: 398600 },
  ],
  outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / r)' }],
}

// Claude is not called in tests: the chat stream is answered here, the rest of the app is real.
test('tutor mode sends a photo, shows a calculator run and its cost, and offers the next hint', async ({
  page,
}, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Tutor test user')
  await page.getByLabel('Email').fill(`tutor-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const sent: { mode: string; message: string; attachments?: { mediaType: string; data: string }[] }[] = []
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: { configured: true } }))
  await page.route('**/api/ai/chat', async (route) => {
    sent.push(route.request().postDataJSON())
    const events = [
      { type: 'thread', threadId: crypto.randomUUID() },
      { type: 'citations', citations: [] },
      { type: 'text', text: sent.length === 1 ? 'Start from the balance of forces.' : 'Now solve for v.' },
      { type: 'widget', widget: { kind: 'calculator', spec: calculator, sourceCalculatorId: null } },
      {
        type: 'usage',
        usage: {
          models: ['claude-sonnet-5-5'],
          inputTokens: 1100,
          outputTokens: 550,
          cacheReadTokens: 2000,
          cacheWriteTokens: 0,
          costUsd: 0.0081,
        },
      },
      { type: 'done', messageId: crypto.randomUUID() },
    ]
    await route.fulfill({
      headers: { 'content-type': 'text/event-stream' },
      body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
    })
  })

  await page.goto('/ai')
  await page.getByRole('tab', { name: 'Tutor' }).click()
  await page.getByLabel('Message').fill('Why is GEO speed about 3 km/s?')
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'working.png', mimeType: 'image/png', buffer: PHOTO })
  await expect(page.getByRole('img', { name: 'Photo 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Tutor', exact: true }).click()

  await expect(page.getByText('Start from the balance of forces.')).toBeVisible()
  expect(sent[0]?.mode).toBe('tutor')
  // The photo is sent as a downscaled JPEG and shown with the question.
  expect(sent[0]?.attachments?.[0]?.mediaType).toBe('image/jpeg')
  await expect(page.getByRole('img', { name: 'Photo 1' })).toBeVisible()
  await expect(page.getByText('Calculated with "Circular orbit"')).toBeVisible()
  await expect(page.getByText('= 3.075 km/s').first()).toBeVisible()
  await expect(
    page.getByText(/3,100 tokens in \(2,000 cached\) · 550 out · ≈ \$0\.0081/).first(),
  ).toBeVisible()
  // A hint is not a worked solution, so it is not offered as a calculator.
  await expect(page.getByRole('button', { name: 'Make a calculator from this' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Next hint' }).click()
  await expect(page.getByText('Now solve for v.')).toBeVisible()
  expect(sent[1]?.message).toBe('Give me the next hint.')
  expect(sent[1]?.attachments).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('tutor.png'), fullPage: true })

  // The full solution, once asked for, can become a reusable calculator.
  await page.getByRole('button', { name: 'Show full solution' }).click()
  await expect.poll(() => sent[2]?.message).toBe('Show me the full worked solution.')
  await expect(page.getByRole('button', { name: 'Make a calculator from this' })).toHaveCount(1)

  // A solution with two independent calculations becomes two calculators, stored with the answer.
  let built: { context: string; messageId?: string } | undefined
  await page.route('**/api/ai/calculator', async (route) => {
    built = route.request().postDataJSON()
    await route.fulfill({
      json: { calculators: [calculator, { ...calculator, name: 'Escape speed' }], failed: [] },
    })
  })
  await page.getByRole('button', { name: 'Make a calculator from this' }).click()
  await expect(page.getByRole('heading', { name: 'Escape speed' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Circular orbit' })).toBeVisible()
  expect(built?.messageId).toMatch(/^[0-9a-f-]{36}$/)
  expect(built?.context).toContain('Show me the full worked solution.')
  await expect(page.getByRole('button', { name: 'Make a calculator from this' })).toHaveCount(0)
})
