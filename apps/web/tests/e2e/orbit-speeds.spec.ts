import { expect, test } from '@playwright/test'

test('orbit speeds: the velocity arrow follows the speed, and time runs on a simulated clock', async ({
  page,
}, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Orbit speed user')
  await page.getByLabel('Email').fill(`speeds-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  // A Molniya orbit at periapsis: vₚ / vₐ = (1 + e) / (1 − e) = 1.74 / 0.26.
  await page.goto('/orbit?a=26600&e=0.74&i=63.4&raan=0&argp=270&nu=0')
  const row = (label: string) =>
    page.locator('dt').getByText(label, { exact: true }).locator('xpath=following-sibling::dd')
  await expect(row('Speed at periapsis')).toHaveText('10.014 km/s')
  await expect(row('Speed at apoapsis')).toHaveText('1.496 km/s')
  await expect(row('Escape speed at r')).toHaveText('10.736 km/s')
  await expect(page.getByTestId('orbit-speed')).toHaveText('10.014 km/s')

  const arrow = page.locator('[data-speed-arrow]')
  await expect(arrow).toHaveAttribute('data-speed-arrow', '72.0')
  // Both apsides show their speed to the same scale.
  await expect(page.locator('[data-apsis-speed]')).toHaveCount(2)
  await expect(page.locator('svg text').filter({ hasText: '10.01 km/s' })).toBeVisible()
  await expect(page.locator('svg text').filter({ hasText: '1.5 km/s' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('orbit-periapsis.png'), fullPage: true })

  // At apoapsis the arrow is as much shorter as the satellite is slower.
  await page.getByLabel('True anomaly', { exact: true }).fill('180')
  await expect(page.getByTestId('orbit-speed')).toHaveText('1.496 km/s')
  const atApoapsis = Number(await arrow.getAttribute('data-speed-arrow'))
  expect(atApoapsis).toBeCloseTo((72 * 0.26) / 1.74, 0)

  // Time warp: ×10 000 covers hours of the 12-hour orbit in a second of real time.
  await page.getByLabel('Time warp').selectOption('10000')
  await expect(page.getByTestId('orbit-elapsed')).toHaveText('0 s')
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Pause' }).click()
  expect((await page.getByTestId('orbit-elapsed').textContent()) ?? '').toMatch(/\d+ h/)
  // Changing the orbit by hand restarts the clock.
  await page.getByLabel('Eccentricity', { exact: true }).fill('0.5')
  await expect(page.getByTestId('orbit-elapsed')).toHaveText('0 s')
})

test('orbit physics: J2 drift, ground track and a Hohmann transfer', async ({ page }, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Orbit physics user')
  await page.getByLabel('Email').fill(`physics-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const row = (label: string) =>
    page.locator('dt').getByText(label, { exact: true }).locator('xpath=following-sibling::dd')
  const run = async (warp: string, ms: number) => {
    await page.getByLabel('Time warp').selectOption(warp)
    await page.getByRole('button', { name: 'Play' }).click()
    await page.waitForTimeout(ms)
    await page.getByRole('button', { name: 'Pause' }).click()
  }

  // Sun-synchronous: the node turns east about 0.986° a day, with the Sun.
  await page.goto('/orbit?a=7078&e=0.001&i=98.2&raan=0&argp=0&nu=0')
  await expect(row('Node drift (J2)')).toHaveText('0.9872 deg/day')
  await page.getByLabel('J2 drift (oblateness)').check()
  await run('10000', 1500)
  expect(
    Number(await page.getByLabel('Right ascension of the ascending node', { exact: true }).inputValue()),
  ).toBeGreaterThan(0.05)

  // Molniya at the critical inclination: the periapsis stays put even with J2.
  await page.goto('/orbit?a=26600&e=0.74&i=63.4&raan=0&argp=270&nu=0')
  await expect(row('Periapsis drift (J2)')).toHaveText(/^4\.0\d*e-4 deg\/day$/)
  await page.getByLabel('J2 drift (oblateness)').check()
  await run('10000', 1500)
  expect(Number(await page.getByLabel('Argument of periapsis', { exact: true }).inputValue())).toBeCloseTo(
    270,
    2,
  )

  // Geostationary: the ground track is a single point over the equator.
  await page.goto('/orbit?a=42164.17&e=0&i=0&raan=0&argp=0&nu=0')
  await page.getByLabel('Ground track').check()
  const dot = page.locator('[data-subsatellite]')
  await expect(dot).toHaveAttribute('data-subsatellite', '0.00,0.00')
  await run('10000', 1500)
  await expect(dot).toHaveAttribute('data-subsatellite', /^-?0\.00,-?0\.0\d$/)

  // Hohmann LEO (6678 km) → GEO: 3.893 km/s in 5 h 16 min (Curtis, Example 6.1).
  await page.goto('/orbit?a=6678&e=0&i=28.5&raan=0&argp=0&nu=0')
  await page.getByLabel('Hohmann transfer').check()
  const hohmann = page.getByRole('region', { name: 'Hohmann transfer' })
  await expect(hohmann.getByLabel('Target orbit radius (km)')).toHaveValue('42164')
  await expect(row('Total Δv')).toHaveText('3.893 km/s')
  await expect(row('Transfer time')).toHaveText('5 h 16 min')
  await expect(page.locator('[data-transfer]')).toHaveCount(1)
  await page.getByLabel('Ground track').check()
  await page.screenshot({ path: testInfo.outputPath('orbit-physics.png'), fullPage: true })
})

test('in the editor, playing an orbit block is not an edit; changing it is', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Orbit editor user')
  await page.getByLabel('Email').fill(`orbit-edit-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const courseId = (
    (await (await page.request.post('/api/courses', { data: { name: 'Astrodynamics' } })).json()) as {
      id: string
    }
  ).id
  const elements = { a: 7078, e: 0.001, i: 98.2, raan: 0, argp: 0, nu: 0 }
  const created = await page.request.post('/api/pages', {
    data: {
      courseId,
      title: 'Sun-synchronous orbits',
      content: {
        type: 'doc',
        content: [{ type: 'widget', attrs: { kind: 'orbit', body: 'earth', elements } }],
      },
    },
  })
  const { id } = (await created.json()) as { id: string }

  await page.goto(`/pages/${id}/edit`)
  await page.getByLabel('J2 drift (oblateness)').check()
  await page.getByLabel('Time warp').selectOption('10000')
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByText('You changed the orbit.', { exact: false })).toHaveCount(0)
  // A change by hand is an edit, and saving stores that orbit, not where the animation left it.
  await page.getByLabel('Eccentricity', { exact: true }).fill('0.01')
  await expect(page.getByText('You changed the orbit.', { exact: false })).toBeVisible()
})
