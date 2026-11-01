import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('a calculator shows its theory and steps, and exports to HTML and Excel', async ({ page }, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Calculator test user')
  await page.getByLabel('Email').fill(`calc-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const created = await page.request.post('/api/calculators', {
    data: {
      spec: {
        version: 1,
        name: 'Projectile motion',
        theory:
          'Horizontal speed is constant; vertically the projectile accelerates downward at g.\n\nAir drag is ignored.',
        inputs: [
          { key: 'v0', label: 'Initial speed', unit: 'm/s', default: 20 },
          { key: 'theta', label: 'Angle', unit: 'deg', default: 30 },
          { key: 'g', label: 'Gravity', unit: 'm/s²', default: 9.81 },
        ],
        outputs: [
          {
            key: 'T',
            label: 'Flight time',
            unit: 's',
            expr: '2 * v0 * sin(theta deg) / g',
            explanation: 'Twice the time to reach the top.',
          },
          { key: 'R', label: 'Range', unit: 'm', expr: 'v0 * cos(theta deg) * T' },
        ],
      },
    },
  })
  expect(created.ok()).toBe(true)
  const { id } = (await created.json()) as { id: string }

  await page.goto(`/calculators/${id}`)
  await expect(page.getByRole('heading', { name: 'Theory' })).toBeVisible()
  await expect(page.getByText('Air drag is ignored.')).toBeVisible()
  const steps = page.getByRole('region', { name: 'Step-by-step solution' })
  await expect(steps.getByText('Twice the time to reach the top.')).toBeVisible()
  await expect(steps.getByText('= 2 * (20 m/s) * sin(30°) / (9.81 m/s²)')).toBeVisible()
  await expect(steps.getByText('= 2.039 s')).toBeVisible()
  // Steps follow the inputs.
  await page.getByLabel('Initial speed').fill('10')
  await expect(steps.getByText('= 2 * (10 m/s) * sin(30°) / (9.81 m/s²)')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('calculator.png'), fullPage: true })

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Theory' })).toHaveValue(/Air drag is ignored\./)
  await expect(page.getByRole('textbox', { name: 'Explanation (why this step)' }).first()).toHaveValue(
    'Twice the time to reach the top.',
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  const xlsx = page.waitForEvent('download')
  await page.getByRole('link', { name: '.xlsx' }).click()
  const workbook = await xlsx
  expect(workbook.suggestedFilename()).toBe('projectile-motion.xlsx')
  // An .xlsx file is a zip archive.
  expect((await readFile(await workbook.path())).subarray(0, 2).toString()).toBe('PK')

  const html = page.waitForEvent('download')
  await page.getByRole('link', { name: '.html' }).click()
  const page2 = await readFile(await (await html).path(), 'utf8')
  expect(page2).toContain('<h2>Step-by-step solution</h2>')
  expect(page2).toContain('Air drag is ignored.')
})

// Claude is not called in tests: the review is answered here; the checks, editor and saving are real.
test('a calculator is checked automatically, and an AI correction is edited and saved', async ({
  page,
}, testInfo) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Calculator check user')
  await page.getByLabel('Email').fill(`calc-check-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')

  const spec = {
    version: 1,
    name: 'Circular orbit',
    inputs: [
      { key: 'r', label: 'Radius', unit: 'km', default: 7000 },
      { key: 'mu', label: 'Gravitational parameter', unit: 'km³/s²', default: 398600 },
    ],
    outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'mu / r^2' }],
  }
  const created = await page.request.post('/api/calculators', { data: { spec } })
  const { id } = (await created.json()) as { id: string }

  await page.goto(`/calculators/${id}`)
  const checks = page.getByRole('region', { name: 'Automatic checks' })
  await expect(checks.getByText('Speed: the formula gives m / s^2, but the unit is km/s.')).toBeVisible()

  await page.route(`**/api/ai/calculators/${id}/review`, (route) =>
    route.fulfill({
      json: {
        findings: [
          { severity: 'error', key: 'v', message: 'This is the gravitational acceleration, not the speed.' },
        ],
        revised: {
          ...spec,
          outputs: [
            {
              key: 'v',
              label: 'Speed',
              unit: 'km/s',
              expr: 'sqrt(mu / r)',
              explanation: 'Gravity provides the centripetal force.',
            },
          ],
        },
        revisedChecks: [],
        usage: null,
      },
    }),
  )
  await page.getByRole('button', { name: 'Check formulas with AI' }).click()
  const review = page.getByRole('region', { name: 'AI check' })
  await expect(review.getByText('This is the gravitational acceleration, not the speed.')).toBeVisible()
  // Each change shows what it was and what it becomes.
  await expect(review.getByRole('listitem').filter({ hasText: 'formula' })).toHaveText(
    /formula\s*mu \/ r\^2\s*sqrt\(mu \/ r\)$/,
  )
  await expect(review.getByRole('listitem').filter({ hasText: 'explanation' })).toContainText(
    'Gravity provides the centripetal force.',
  )

  await page.screenshot({ path: testInfo.outputPath('calculator-review.png'), fullPage: true })
  await review.getByRole('button', { name: 'Edit with these changes' }).click()
  await expect(page.getByText('The proposed changes are in the editor.', { exact: false })).toBeVisible()
  await expect(checks).toHaveCount(0)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()

  const saved = (await (await page.request.get(`/api/calculators/${id}`)).json()) as {
    spec: { outputs: { expr: string; explanation?: string }[] }
  }
  expect(saved.spec.outputs[0]).toMatchObject({
    expr: 'sqrt(mu / r)',
    explanation: 'Gravity provides the centripetal force.',
  })
  await expect(page.getByRole('region', { name: 'Automatic checks' })).toHaveCount(0)
})
