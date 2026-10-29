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
