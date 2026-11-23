import { expect, test } from '@playwright/test'

// No AI: the problem, the check and the solution all come from the calculator.
test('a practice problem from a calculator: new numbers, answers checked, solution on request', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Practiser')
  await page.getByLabel('Email').fill(`practice-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const mu = 398600.4418
  const { id } = (await (
    await page.request.post('/api/calculators', {
      data: {
        spec: {
          version: 1,
          name: 'Circular speed',
          inputs: [{ key: 'r', label: 'Radius', unit: 'km', default: 7000, min: 6500, max: 9500, step: 1 }],
          constants: { mu },
          constantMetadata: { mu: { name: 'Gravitational parameter', symbol: 'μ', unit: 'km³/s²' } },
          outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / r)', precision: 3 }],
        },
      },
    })
  ).json()) as { id: string }

  await page.goto(`/calculators/${id}`)
  await page.getByRole('button', { name: 'Practice problem' }).click()
  const panel = page.getByRole('region', { name: 'Practice problem' })
  await expect(panel.getByText('A problem like this one, with new numbers')).toBeVisible()
  const given = panel.getByRole('list', { name: 'Given' }).getByRole('listitem')
  const radius = async () => Number((await given.textContent())?.match(/([\d.]+)\s*km/)?.[1])
  const r = await radius()
  expect(r).toBeGreaterThanOrEqual(6500)
  expect(r).toBeLessThanOrEqual(9500)
  const exact = Math.sqrt(mu / r)

  // A wrong answer is marked without giving the right one away.
  const answer = panel.getByLabel('Speed')
  await answer.fill('1.5')
  await panel.getByRole('button', { name: 'Check my answers' }).click()
  await expect(panel.getByText('✗ Not quite')).toBeVisible()
  await expect(panel.getByText(/Answer:/)).toHaveCount(0)
  // A rounded answer with a decimal comma counts.
  await answer.fill(exact.toFixed(2).replace('.', ','))
  await panel.getByRole('button', { name: 'Check my answers' }).click()
  await expect(panel.getByText('✓ Correct')).toBeVisible()
  await expect(panel.getByText('1 of 1 right')).toBeVisible()

  // The solution shows the exact answer and the steps with these numbers.
  await panel.getByRole('button', { name: 'Show solution' }).click()
  await expect(panel.getByText(`Answer: ${Number(exact.toFixed(3))} km/s`)).toBeVisible()
  await expect(panel.getByText(new RegExp(`^= sqrt\\(.*\\(${r} km\\)\\)$`))).toBeVisible()

  // A new problem has new numbers and a clean slate.
  await panel.getByRole('button', { name: 'New problem' }).click()
  await expect(answer).toHaveValue('')
  await expect(panel.getByText(/Answer:/)).toHaveCount(0)
  await expect.poll(radius).not.toBe(r)

  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toHaveCount(0)
})
