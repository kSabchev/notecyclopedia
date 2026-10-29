import { expect, test } from '@playwright/test'

// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

test('insert a plot, a calculator and an image into a page, then read them', async ({ page }, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Widget test user')
  await page.getByLabel('Email').fill(`widgets-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  await page.getByRole('button', { name: 'New course' }).click()
  await page.getByLabel('Course name').fill('Orbital mechanics')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Orbital mechanics' })).toBeVisible()

  const courses = (await (await page.request.get('/api/courses')).json()) as Array<{
    id: string
    name: string
  }>
  const courseId = courses.find((c) => c.name === 'Orbital mechanics')?.id
  const created = await page.request.post('/api/calculators', {
    data: {
      courseId,
      spec: {
        version: 1,
        name: 'Circular orbit',
        inputs: [
          { key: 'r', label: 'Orbit radius', unit: 'km', default: 7000, min: 6600, max: 42164 },
          { key: 'mu', label: 'Gravitational parameter', unit: 'km³/s²', default: 398600 },
        ],
        outputs: [
          { key: 'v', label: 'Orbital speed', unit: 'km/s', expr: 'sqrt(mu / r)' },
          { key: 'T', label: 'Period', unit: 's', expr: '2 * pi * sqrt(r^3 / mu)' },
        ],
      },
    },
  })
  expect(created.ok()).toBe(true)

  await page.getByRole('link', { name: 'New page' }).click()
  await page.locator('#page-title').fill('Circular orbits')
  await page.locator('.ProseMirror').fill('Speed and period of a circular orbit.')

  await page.getByRole('button', { name: 'Calculator', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Insert calculator' })
  await dialog.getByLabel('Plot').check()
  await dialog.getByLabel('Period').check()
  await dialog.getByRole('button', { name: 'Insert' }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: 'Calculator', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Insert calculator' })
    .getByRole('button', { name: 'Insert' })
    .click()

  await page.locator('input[type="file"][accept^="image"]').setInputFiles({
    name: 'orbit.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  await page.getByRole('textbox', { name: 'Caption' }).fill('Orbit sketch')
  await page.getByRole('button', { name: 'Save revision' }).click()
  await expect(page.getByRole('heading', { name: 'Circular orbits' })).toBeVisible()

  // Different units never share an axis: speed and period get a chart each.
  const speedChart = page.getByRole('slider', { name: /Orbital speed against Orbit radius/ })
  await expect(speedChart).toBeVisible()
  await expect(page.getByRole('slider', { name: /Period against Orbit radius/ })).toBeVisible()
  await speedChart.focus()
  await page.keyboard.press('ArrowRight')
  await expect(speedChart).toHaveAttribute('aria-valuetext', /Orbit radius \(km\) 6600: Orbital speed 7\.77/)

  await page.getByRole('button', { name: 'Show table' }).click()
  await expect(page.getByRole('columnheader', { name: 'Period (s)' })).toBeVisible()

  await expect(page.getByRole('img', { name: 'orbit.png' })).toBeVisible()
  await expect(page.getByText('Orbit sketch')).toBeVisible()
  // The interactive calculator shows the speed for the default radius.
  await expect(page.getByText('7.546')).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('widgets-light.png'), fullPage: true })
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.screenshot({ path: testInfo.outputPath('widgets-dark.png'), fullPage: true })
})

test('insert an orbit diagram, explore it, and open the orbit viewer', async ({ page }, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Orbit test user')
  await page.getByLabel('Email').fill(`orbit-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  await page.getByRole('button', { name: 'New course' }).click()
  await page.getByLabel('Course name').fill('Astrodynamics')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Astrodynamics' })).toBeVisible()

  await page.getByRole('link', { name: 'New page' }).click()
  await page.locator('#page-title').fill('Molniya orbits')
  await page.getByRole('button', { name: 'Calculator', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Insert calculator' })
  await dialog.getByLabel('Orbit diagram').check()
  await dialog.getByLabel('Preset').selectOption({ label: 'Molniya' })
  await dialog.getByRole('button', { name: 'Insert' }).click()
  await page.getByRole('button', { name: 'Save revision' }).click()
  await expect(page.getByRole('heading', { name: 'Molniya orbits' })).toBeVisible()

  // A 12-hour orbit: a = 26 600 km around Earth.
  await expect(page.getByText('11 h 59 min')).toBeVisible()
  await expect(page.getByLabel('Inclination', { exact: true })).toHaveValue('63.4')
  await page.getByLabel('Equal areas').check()
  await expect(page.getByText(/shaded sectors is swept in the same time/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('orbit-light.png'), fullPage: true })

  // Readers can change the elements; a circular orbit has equal periapsis and apoapsis altitude.
  await page.getByLabel('Eccentricity', { exact: true }).fill('0')
  await expect(page.locator('dd').filter({ hasText: '20221.9 km' })).toHaveCount(2)
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.screenshot({ path: testInfo.outputPath('orbit-dark.png'), fullPage: true })

  await page.goto('/orbit?a=42164&e=0&i=0')
  await expect(page.getByRole('heading', { name: 'Orbit viewer' })).toBeVisible()
  await expect(page.getByText('23 h 56 min')).toBeVisible()
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await page.goto('/orbit?a=26600&e=0.74&i=63.4&raan=40&argp=270&nu=150')
  await page.screenshot({ path: testInfo.outputPath('orbit-viewer.png'), fullPage: true })
})

test('preview a GMAT script and open its spacecraft in the orbit viewer', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('GMAT test user')
  await page.getByLabel('Email').fill(`gmat-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  await page.getByRole('button', { name: 'New course' }).click()
  await page.getByLabel('Course name').fill('Mission design')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Mission design' })).toBeVisible()

  await page.getByRole('link', { name: 'Uploads' }).click()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'Molniya.script',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(
      [
        '% A Molniya spacecraft',
        'Create Spacecraft Molniya1;',
        'GMAT Molniya1.SMA = 26600;',
        'GMAT Molniya1.ECC = 0.74;',
        'GMAT Molniya1.INC = 63.4;',
        'GMAT Molniya1.AOP = 270;',
      ].join('\n'),
    ),
  })
  await page.getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByText('GMAT Molniya1.SMA = 26600;')).toBeVisible()
  await expect(page.getByText('a 26600 km · e 0.74 · i 63.4°')).toBeVisible()
  await page.getByRole('link', { name: 'Open in orbit viewer' }).click()
  await expect(page.getByRole('heading', { name: 'Orbit viewer' })).toBeVisible()
  await expect(page.getByLabel('Argument of periapsis', { exact: true })).toHaveValue('270')
  await expect(page.getByText('11 h 59 min')).toBeVisible()
})
