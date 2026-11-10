import { expect, test } from '@playwright/test'

// Claude is not called in tests: the rework is answered here; the list, archive, copy and saving are real.
test('personal calculators sorted by course tag, archived, duplicated and reworked', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Librarian')
  await page.getByLabel('Email').fill(`library-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('browser-test-password')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await expect(page).toHaveURL('/')
  const course = async (name: string) =>
    ((await (await page.request.post('/api/courses', { data: { name } })).json()) as { id: string }).id
  const astro = await course('Astrodynamics')
  const mission = await course('Mission design')
  const calc = async (name: string, courseId: string | null, lectureNumber: number | null) =>
    (
      (await (
        await page.request.post('/api/calculators', {
          data: {
            courseId,
            lectureNumber,
            spec: {
              version: 1,
              name,
              inputs: [{ key: 'r', label: 'Radius', unit: 'km', default: 7000 }],
              constants: { mu: 398600.4418 },
              constantMetadata: { mu: { name: 'Gravitational parameter', symbol: 'μ', unit: 'km³/s²' } },
              outputs: [{ key: 'v', label: 'Speed', unit: 'km/s', expr: 'sqrt(mu / r)' }],
            },
          },
        })
      ).json()) as { id: string }
    ).id
  const visViva = await calc('Vis-viva', astro, 2)
  await calc('Orbital period', astro, 1)
  await calc('Launch window', mission, null)
  await calc('Unit converter', null, null)

  // Grouped by course tag (in course order, untagged last), then by lecture.
  await page.goto('/calculators')
  const list = page.getByRole('region', { name: 'Calculators' })
  await expect(list.getByRole('heading', { level: 3 })).toHaveText([
    'Astrodynamics',
    'Mission design',
    'No course',
  ])
  const names = list.getByRole('link').filter({ hasText: /=/ })
  await expect(names).toHaveText([/Orbital period/, /Vis-viva/, /Launch window/, /Unit converter/])
  await expect(names.first()).toContainText('Astrodynamics · Lecture 1')
  await list.getByLabel('Sort').selectOption('name')
  await expect(names).toHaveText([/Launch window/, /Orbital period/, /Unit converter/, /Vis-viva/])
  await list.getByLabel('Show course').selectOption({ label: 'Mission design' })
  await expect(names).toHaveText([/Launch window/])
  await list.getByLabel('Show course').selectOption({ label: 'All courses' })

  // Archive: out of the list, under Archived, and back.
  await names.filter({ hasText: 'Unit converter' }).click()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(page.getByText(/^Archived: hidden from your list/)).toBeVisible()
  await expect(names.filter({ hasText: 'Unit converter' })).toHaveCount(0)
  await list.getByRole('button', { name: 'Archived' }).click()
  await expect(names).toHaveText([/Unit converter/])
  await names.first().click()
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(names).toHaveCount(0)
  await list.getByRole('button', { name: 'All', exact: true }).click()
  await expect(names).toHaveCount(4)

  // Duplicate: a copy to change, linked to its original.
  await page.goto(`/calculators/${visViva}`)
  await page.getByRole('button', { name: 'Duplicate' }).click()
  await expect(page.getByRole('heading', { name: 'Vis-viva (copy)' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Copy of Vis-viva' })).toHaveAttribute(
    'href',
    `/calculators/${visViva}`,
  )
  const copyId = page.url().split('/').at(-1) as string

  // Rework with AI: describe the change, review it as changes, edit and save.
  await page.route(`**/api/ai/calculators/${copyId}/rework`, async (route) => {
    const body = route.request().postDataJSON() as { instructions: string }
    expect(body.instructions).toBe('Add the escape speed')
    const current = (await (await page.request.get(`/api/calculators/${copyId}`)).json()) as {
      spec: { outputs: unknown[] }
    }
    await route.fulfill({
      json: {
        findings: [{ severity: 'note', key: 'v_esc', message: 'Added the escape speed.' }],
        revised: {
          ...current.spec,
          outputs: [
            ...current.spec.outputs,
            { key: 'v_esc', label: 'Escape speed', unit: 'km/s', expr: 'sqrt(2) * v' },
          ],
        },
        revisedChecks: [],
        usage: null,
      },
    })
  })
  await page.getByRole('button', { name: 'Rework with AI' }).click()
  await page.getByLabel('What should change?').fill('Add the escape speed')
  await page.getByRole('button', { name: 'Propose changes' }).click()
  const proposal = page.getByRole('region', { name: 'AI rework' })
  await expect(proposal.getByText('Added the escape speed.')).toBeVisible()
  await expect(proposal.getByRole('listitem').filter({ hasText: 'v_esc = sqrt(2) * v' })).toBeVisible()
  await proposal.getByRole('button', { name: 'Edit with these changes' }).click()
  await expect(page.getByText('Only you see your calculators.')).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  const saved = (await (await page.request.get(`/api/calculators/${copyId}`)).json()) as {
    spec: { outputs: { key: string }[] }
  }
  expect(saved.spec.outputs.map((o) => o.key)).toEqual(['v', 'v_esc'])
  // The original is untouched.
  const original = (await (await page.request.get(`/api/calculators/${visViva}`)).json()) as {
    spec: { outputs: { key: string }[] }
  }
  expect(original.spec.outputs.map((o) => o.key)).toEqual(['v'])
})
