import { expect, test } from '@playwright/test'

test('uploads can be searched, filtered and paged; the backup page says when the last backup was', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Archivist')
  await page.getByLabel('Email').fill(`archive-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const course = async (name: string) =>
    ((await (await page.request.post('/api/courses', { data: { name } })).json()) as { id: string }).id
  const astro = await course('Astrodynamics')
  const mission = await course('Mission design')
  const upload = (courseId: string, name: string) =>
    page.request.post('/api/files', {
      multipart: {
        courseId,
        files: { name, mimeType: 'text/plain', buffer: Buffer.from(`Notes: ${name}`) },
      },
    })
  // More than one page of uploads (50 a page).
  for (let i = 1; i <= 50; i++) await upload(astro, `week-${String(i).padStart(2, '0')}.txt`)
  await upload(mission, 'launch-windows.txt')

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Uploads', exact: true })
    .click()
  const rows = page.getByRole('row')
  await expect(rows).toHaveCount(50)
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(rows).toHaveCount(51)
  await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0)

  await page.getByLabel('Search uploads').fill('LAUNCH')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('launch-windows.txt')
  await page.getByLabel('Show course').selectOption({ label: 'Astrodynamics' })
  await expect(page.getByText('No uploads match.')).toBeVisible()
  await page.getByLabel('Search uploads').fill('week-07')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('week-07.txt')

  // Backup: never made, then made just now.
  await page.goto('/backup')
  await expect(page.getByText('You have not downloaded a backup yet.')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download backup' }).click()
  await (await download).path()
  await expect(page.getByText(/^Last backup: /)).toBeVisible()
})

test('switching the language loads its text, and the choice is kept on reload', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Polyglot')
  await page.getByLabel('Email').fill(`lang-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Home', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Език: Български' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'bg')
  await page.reload()
  await expect(page.getByRole('link', { name: 'Начало', exact: true }).first()).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'bg')

  await page.getByRole('button', { name: 'Language: English' }).click()
  await expect(page.getByRole('link', { name: 'Home', exact: true }).first()).toBeVisible()
})

test('an unknown address or course says so, and tabs carry the page title', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Wanderer')
  await page.getByLabel('Email').fill(`wander-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  await expect(page).toHaveTitle('Home · Notecyclopedia')

  await page.goto('/no-such-place')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Go home' }).click()
  await expect(page).toHaveURL('/')

  // A course that is not yours (or no longer exists) does not wait forever.
  await page.goto(`/courses/${crypto.randomUUID()}`)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Calculators', exact: true })
    .click()
  await expect(page).toHaveTitle('Calculators · Notecyclopedia')
})

test('the app says when it cannot reach the server, and when it is back', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Commuter')
  await page.getByLabel('Email').fill(`offline-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  // The browser goes offline. (Simulated in the page: cutting the network would also cut the dev server's live
  // reload, which reloads the page; production has no such client.)
  const setOnline = (online: boolean) =>
    page.evaluate((value) => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
      window.dispatchEvent(new Event(value ? 'online' : 'offline'))
    }, online)
  await setOnline(false)
  await expect(page.getByText('You are offline. Reconnect to save changes and load new data.')).toBeVisible()
  await setOnline(true)
  await expect(page.getByText('You are offline.')).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Back online' })).toBeVisible()

  // Online, but the server does not answer: requests fail until it is back.
  await page.route('**/api/**', (route) => route.abort('connectionrefused'))
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Formulas', exact: true })
    .click()
  await expect(page.getByText('Cannot reach the Notecyclopedia server. Retrying…')).toBeVisible()
  // A failed session check is not a sign-out: the page stays.
  await expect(page).toHaveURL('/formulas')
  await page.unroute('**/api/**')
  await expect(page.getByText('Cannot reach the Notecyclopedia server.')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.getByRole('status').filter({ hasText: 'Back online' })).toBeVisible()
})
